<template>
	<div class="track-controls-wrapper no-select" :style="wrapperStyles" @contextmenu.prevent>
		<div v-for="([id, track], index) in sortedTracks" :key="id" class="track-controls">
			<p v-if="track.title" class="small no-select">{{ track.title }}</p>
			<p v-else class="small dim track-title no-select">Track {{ index + 1 }}</p>
			<UseElementBounding v-slot="{ top, height }" style="grid-area: vol">
				<div class="volumeSlider" @pointerdown="startVolumeDrag($event, id, top, height)">
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
			<p
				v-if="track.belongs_to_display_name"
				class="small dim no-select"
				style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap"
			>
				@{{ track.belongs_to_display_name }}
			</p>
		</div>
	</div>
</template>

<script setup lang="ts">
import { tracks, pxTrackHeight, altKeyPressed, controlKeyPressed } from '@/state'
import { computed, reactive, useTemplateRef, watch, type CSSProperties } from 'vue'
import { getTrackVolume, isPlaying, setTrackGain } from '@/audioEngine'
import { useRafFn, useEventListener } from '@vueuse/core'
import { UseElementBounding } from '@vueuse/components'
import { socket } from '@/socket/socket'
import { useToast } from '@/composables/useToast'

const wrapperStyles = computed((): CSSProperties => {
	return {
		gridAutoRows: `${pxTrackHeight}px`,
	}
})

const sortedTracks = computed(() => {
	return [...tracks.entries()].sort((a, b) => a[1].order_index - b[1].order_index)
})

const trackVolumes = reactive(new Map<string, number>())
const { addToast } = useToast()

const { pause, resume } = useRafFn(
	() => {
		for (const id of tracks.keys()) {
			const vol = getTrackVolume(id)
			// todo: smooth decay could be nice, but raw for now
			trackVolumes.set(id, vol)
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

function startVolumeDrag(e: PointerEvent, trackId: string, top: number, height: number) {
	const target = e.currentTarget as HTMLElement
	target.setPointerCapture(e.pointerId)

	const track = tracks.get(trackId)
	if (!track) return // todo: toast, track has already been deleted
	const initialGain = track.gain

	const range = 2
	const min = 0

	function update(e: PointerEvent) {
		const relativeY = Math.max(0, Math.min(1, 1 - (e.clientY - top) / height))

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
	update(e)

	function onMove(e: PointerEvent) {
		update(e)
	}

	const { stop: stopKeys } = watch([altKeyPressed, controlKeyPressed], (alt, crtl) => {
		if (alt || crtl) {
			update(e)
		}
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
				addToast({
					type: 'notification',
					message: res.error.message,
					priority: 'medium',
					icon: 'warning',
				})
			}
		}
	}

	const stopMove = useEventListener(window, 'pointermove', onMove)
	const stopUp = useEventListener(window, 'pointerup', onEnd)
	const stopLostCapture = useEventListener(target, 'lostpointercapture', onEnd)
}
</script>

<style scoped>
.track-controls-wrapper {
	display: grid;
	grid-auto-rows: auto;
	position: sticky;
	left: 0;
	z-index: 40;

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
	grid-template-areas: 'title vol' '. vol';

	column-gap: 0.2rem;

	width: 11rem;

	border-bottom: 1px solid var(--border-primary);

	box-shadow: 1px 0px 0px 0px var(--border-primary);

	background-color: var(--bg-color);
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
</style>
