<template>
	<div class="track-controls-wrapper no-select" :style="wrapperStyles" ref="wrapperRef">
		<div
			v-for="([id, track], index) in sortedTracks"
			:key="id"
			class="track-controls"
			@contextmenu.prevent="openContextMenu($event, id)"
			:class="{ active: contextMenuTrackId === id }"
		>
			<p v-if="track.title" class="small no-select">{{ track.title }}</p>
			<p v-else class="small dim track-title no-select">Track {{ index + 1 }}</p>

			<UseElementBounding v-slot="{ top, height }" style="grid-area: vol">
				<div
					class="volumeSlider"
					@pointerdown="startVolumeDrag($event, id, top, height)"
					@click.stop
					@contextmenu.prevent.stop="resetVolume(id)"
				>
					<div
						class="volume-meter-fill"
						:style="{
							height: `${(trackVolumes.get(id) ?? 0) * 100}%`,
						}"
					></div>
					<div
						class="volume-thumb"
						:style="{
							bottom: `${track.gain * 50}%`,
						}"
					></div>
					<div class="volume-zero-marker"></div>
				</div>
			</UseElementBounding>

			<button
				class="menu-trigger-btn"
				@click.stop="toggleContextMenu(id)"
				:class="{ active: contextMenuTrackId === id }"
				style="grid-area: menu"
			>
				<Ellipsis :size="16" />
			</button>

			<!-- context menu -->
			<div
				v-if="contextMenuTrackId === id"
				v-on-click-outside="() => (contextMenuTrackId = null)"
				class="context-menu"
				@contextmenu.stop.prevent
				@click.stop
			>
				<div class="inner-menu-wrap">
					<div class="menu-header">
						<p
							class="small bold"
							style="
								color: var(--text-color-primary);
								overflow: hidden;
								text-overflow: ellipsis;
								white-space: nowrap;
							"
						>
							{{ track.title || `Track ${index + 1}` }}
						</p>
						<p
							class="small dim mono"
							style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap"
						>
							@{{ track.belongs_to_display_name }}
						</p>
					</div>
					<div
						style="
							border-top: 1px solid var(--border-primary);
							margin-top: 0.5rem;
							padding-bottom: 0.5rem;
						"
					></div>
					<button class="default-button menu-btn delete" @mousedown="deleteTrack(id)">
						<Trash2 :size="13" style="color: var(--text-color-secondary)" />
						<p class="small">Delete Track</p>
					</button>
				</div>
			</div>
		</div>
	</div>
</template>

<script setup lang="ts">
import { tracks, pxTrackHeight, altKeyPressed, controlKeyPressed, clips } from '@/state'
import { computed, reactive, useTemplateRef, watch, type CSSProperties, shallowRef } from 'vue'
import { getTrackVolume, isPlaying, setTrackGain, unregisterTrack } from '@/audioEngine'
import { useRafFn, useEventListener, onClickOutside } from '@vueuse/core'
import { UseElementBounding, vOnClickOutside } from '@vueuse/components'
import { socket } from '@/socket/socket'
import { useConsole } from '@/composables/useConsole'
import { Trash2, Ellipsis } from 'lucide-vue-next'
import { DEFAULT_GAIN } from '~/constants'
import type { Clip } from '~/schema'

const wrapperStyles = computed((): CSSProperties => {
	return {
		gridAutoRows: `${pxTrackHeight}px`,
	}
})

const sortedTracks = computed(() => {
	return [...tracks.entries()].sort((a, b) => a[1].order_index - b[1].order_index)
})

const trackVolumes = reactive(new Map<string, number>())
const { userLog } = useConsole()

const DECAY_RATE = 0.15 as const // Lower = slower decay, higher = faster decay (0-1)

const { pause, resume } = useRafFn(
	() => {
		for (const id of tracks.keys()) {
			const currentVol = getTrackVolume(id)
			const prevVol = trackVolumes.get(id) ?? 0

			// Instant rise, smooth decay
			const newVol =
				currentVol >= prevVol ? currentVol : prevVol - (prevVol - currentVol) * DECAY_RATE
			trackVolumes.set(id, Math.max(0, newVol))
		}
	},
	{ fpsLimit: 30, immediate: isPlaying.value },
)

watch(isPlaying, (playing) => {
	if (playing) {
		resume()
	} else {
		pause()
		for (const id of tracks.keys()) {
			trackVolumes.set(id, 0)
		}
	}
})

// --- Context Menu Logic ---
const contextMenuTrackId = shallowRef<string | null>(null)

function openContextMenu(e: MouseEvent, trackId: string) {
	contextMenuTrackId.value = trackId
}

function toggleContextMenu(trackId: string) {
	if (contextMenuTrackId.value === trackId) {
		contextMenuTrackId.value = null
	} else {
		contextMenuTrackId.value = trackId
	}
}

async function deleteTrack(trackId: string) {
	contextMenuTrackId.value = null

	const track = tracks.get(trackId)
	if (!track) return

	const clipsToDelete: Clip[] = []

	for (const [_, clip] of clips.entries()) {
		if (clip.track_id === trackId) clipsToDelete.push(clip)
	}

	clipsToDelete.forEach((clip) => clips.delete(clip.id))

	const optimisticTrack = { ...track }

	unregisterTrack(trackId)
	tracks.delete(trackId)

	const res = await socket.emitWithAck('get:track:delete', { id: trackId })

	if (!res.success) {
		tracks.set(trackId, optimisticTrack)

		clipsToDelete.forEach((clip) => clips.set(clip.id, clip))

		userLog('SYSTEM', `Failed to delete track: ${res.error.message}`, {
			textColor: 'red',
			isBold: true,
		})
	}
}

function startVolumeDrag(e: PointerEvent, trackId: string, top: number, height: number) {
	if (e.button !== 0) return

	const target = e.currentTarget as HTMLElement
	target.setPointerCapture(e.pointerId)

	const track = tracks.get(trackId)
	if (!track) {
		userLog('SYSTEM', 'This track has been deleted.', {
			textColor: 'yellow',
		})
		return
	}
	const initialGain = track.gain

	const SENSITIVITY = 0.2

	const range = 2
	const min = 0

	const startY = e.clientY
	let currentClientY = e.clientY
	const startRelativeY = Math.max(0, Math.min(1, 1 - (e.clientY - top) / height))

	function update(clientY: number) {
		const deltaY = startY - clientY
		const relativeDelta = (deltaY / height) * SENSITIVITY
		const relativeY = Math.max(0, Math.min(1, startRelativeY + relativeDelta))

		let gain: number = min + relativeY * range

		if (altKeyPressed.value || controlKeyPressed.value) {
			gain = 1
		}

		// update local state optimistically
		const track = tracks.get(trackId)

		if (track) {
			track.gain = gain
			setTrackGain(trackId, gain)
		}
	}

	// Initial click update
	update(currentClientY)

	function onMove(e: PointerEvent) {
		currentClientY = e.clientY
		update(currentClientY)
	}

	const { stop: stopKeys } = watch([altKeyPressed, controlKeyPressed], () => {
		update(currentClientY)
	})

	async function onEnd() {
		// Cleanup listeners
		stopMove()
		stopUp()
		stopLostCapture()
		stopKeys()

		if (target.hasPointerCapture(e.pointerId)) {
			target.releasePointerCapture(e.pointerId)
		}

		// Final sync
		const track = tracks.get(trackId)
		if (track) {
			const res = await socket.emitWithAck('get:track:update', {
				id: trackId,
				changes: { gain: track.gain },
			})

			if (!res.success) {
				track.gain = initialGain
				setTrackGain(trackId, initialGain)
				userLog('SYSTEM', `Failed to update track gain: ${res.error.message}`, {
					textColor: 'red',
				})
			}
		}
	}

	const stopMove = useEventListener(window, 'pointermove', onMove)
	const stopUp = useEventListener(window, 'pointerup', onEnd)
	const stopLostCapture = useEventListener(target, 'lostpointercapture', onEnd)
}

async function resetVolume(trackId: string) {
	const track = tracks.get(trackId)
	if (!track) return

	const initialGain = track.gain
	const newGain = DEFAULT_GAIN

	track.gain = newGain // todo: this should be done automatically by settrackgain
	setTrackGain(trackId, newGain)

	const res = await socket.emitWithAck('get:track:update', {
		id: trackId,
		changes: { gain: newGain },
	})

	if (!res.success) {
		// Revert
		track.gain = initialGain
		setTrackGain(trackId, initialGain)
		userLog('SYSTEM', `Failed to reset track gain: ${res.error.message}`, {
			textColor: 'yellow',
		})
	}
}
</script>

<style scoped>
.track-controls-wrapper {
	display: grid;
	grid-auto-rows: auto;
	position: sticky;
	left: 0;
	z-index: 100;

	padding-top: 2rem;
}

.track-title {
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.track-controls {
	padding: 0.8rem 1rem;
	/* background-color: hsl(0, 0%, 9%); */

	color: var(--text-color-primary);

	z-index: 10;

	display: grid;
	grid-template-columns: 1fr auto;
	grid-template-areas: 'title vol' 'menu vol';

	column-gap: 0.2rem;

	width: 11rem;

	border-bottom: 1px solid var(--border-primary);

	box-shadow: 1px 0px 0px 0px var(--border-primary);

	background-color: var(--bg-color);

	position: relative;
}

.track-controls.active {
	background-color: color-mix(in lch, var(--bg-color), white 5%);
}

.track-controls:first-child {
	box-shadow: 1px -1px 0px 0px var(--border-primary);
}

.track-controls:last-child {
	border-bottom: none;
}

.volumeSlider {
	position: relative;
	height: 100%;
	width: 1.1rem;

	background-color: color-mix(in lab, var(--border-primary), black 65%);
	display: flex;
	flex-direction: column;
	justify-content: flex-end;
	touch-action: none;
	/* prevent scroll while dragging */
	cursor: ns-resize;
}

.volume-meter-fill {
	width: 100%;
	background: linear-gradient(
		to top,
		var(--border-primary) 10px,
		color-mix(in lch, var(--border-primary), white 60%) 69px
	);
	min-height: 0;
	transition: height 0.1s linear;
}

.volume-thumb {
	position: absolute;
	left: 0;
	right: 0;
	height: 1px;
	background-color: white;
	pointer-events: none;
	box-shadow: 0 0 2px black;
}

.volume-zero-marker {
	position: absolute;
	top: 50%;
	left: 0;
	right: 0;
	height: 1px;
	background-color: color-mix(in lch, var(--border-primary), white 20%);
	opacity: 0.5;
	pointer-events: none;
}

/* Context Menu Styles */
.context-menu {
	position: absolute;
	left: calc(100% + 0.5rem);
	top: 0.5rem;
	width: 14rem;
	border-radius: 0.75rem;
	display: grid;
	z-index: 100;
}

.inner-menu-wrap {
	display: grid;
	border-radius: inherit;
	padding: 0.5rem;
	width: 100%;
	box-shadow: 0px 0px 1rem 0rem var(--bg-color);
	background-color: color-mix(in lch, var(--bg-color), white 10%);
	border: 1px solid var(--border-primary);
}

.menu-header {
	padding: 0.3rem 0.5rem;
	display: flex;
	flex-direction: column;
	gap: 0.1rem;
	max-width: 16rem;
}

.menu-btn {
	background-color: transparent;
	box-shadow: none;
	justify-content: flex-start;
	white-space: nowrap;
	gap: 0.6rem;
	padding-left: 0.6rem;
}

.menu-btn:hover {
	background-color: color-mix(in lch, transparent, white 15%);
	box-shadow: none;
}

.menu-btn.delete {
	color: var(--text-color-primary);
}

.menu-btn.delete:hover {
	background-color: color-mix(in lch, #ff4444, black 20%);
	color: white;
}

.menu-trigger-btn {
	background-color: transparent;
	border: none;
	color: var(--text-color-secondary);
	opacity: 1;
	padding: 0;
	border-radius: 0.25rem;
	display: flex;
	align-items: center;
	justify-content: center;
	cursor: pointer;
	height: min-content;
	width: min-content;

	margin-top: auto;
	position: relative;
}

.menu-trigger-btn::after {
	content: '';
	position: absolute;
	top: -2px;
	bottom: -2px;
	left: -5px;
	right: -5px;
	background-color: inherit;
	border-radius: 0.6rem;
	z-index: -1;
}

.menu-trigger-btn:hover,
.menu-trigger-btn.active {
	background-color: color-mix(in lch, var(--bg-color), white 15%);
	color: var(--text-color-primary);
}
</style>
