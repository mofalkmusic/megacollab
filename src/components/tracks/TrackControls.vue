<template>
	<div class="track-controls-wrapper" :style="wrapperStyles">
		<div v-for="([id, track], index) in sortedTracks" :key="id" class="track-controls">
			<p v-if="track.title" class="small">{{ track.title }}</p>
			<p v-else class="small dim track-title">Track {{ index + 1 }}</p>
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
							bottom: `${((track.gain_db + 35) / 40) * 100}%`,
						}"
					></div>
					<div class="volume-zero-marker"></div>
				</div>
			</UseElementBounding>
			<p
				v-if="track.belongs_to_display_name"
				class="small dim"
				style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap"
			>
				@{{ track.belongs_to_display_name }}
			</p>
		</div>
	</div>
</template>

<script setup lang="ts">
import { tracks, pxTrackHeight } from '@/state'
import { computed, reactive, useTemplateRef, watch, type CSSProperties } from 'vue'
import { getTrackVolume, isPlaying, setTrackGain } from '@/audioEngine'
import { useRafFn } from '@vueuse/core'
import { UseElementBounding } from '@vueuse/components'
import { socket } from '@/socket/socket'

const wrapperStyles = computed((): CSSProperties => {
	return {
		gridAutoRows: `${pxTrackHeight}px`,
	}
})

const sortedTracks = computed(() => {
	return [...tracks.entries()].sort((a, b) => a[1].order_index - b[1].order_index)
})

const trackVolumes = reactive(new Map<string, number>())

const { pause, resume } = useRafFn(
	() => {
		for (const id of tracks.keys()) {
			const vol = getTrackVolume(id)
			// smooth decay could be nice, but raw for now
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

// const volumeSliderEl = useTemplateRef('volumeSlider')

// const { bottom } = useElementBounding(volumeSliderEl)

// useEventListener(volumeSliderEl, 'pointerdown', (event) => { })

// todo: make own
function startVolumeDrag(e: PointerEvent, trackId: string, top: number, height: number) {
	const target = e.currentTarget as HTMLElement
	target.setPointerCapture(e.pointerId)

	const range = 40 // -35 to +5
	const min = -35

	function update(e: PointerEvent) {
		// y is from top.
		// relative y from bottom = rect.height - (e.clientY - rect.top)
		// but simplified: 0 at bottom, 1 at top.
		// val = 1 - (e.clientY - rect.top) / rect.height
		const relativeY = Math.max(0, Math.min(1, 1 - (e.clientY - top) / height))

		const db = min + relativeY * range
		// clamp
		const clampedDb = Math.max(-35, Math.min(5, db))

		// update local state optimistic
		const track = tracks.get(trackId)
		if (track) {
			track.gain_db = clampedDb
			// direct audio update for responsiveness (watcher might be slightly delayed or just to be safe)
			setTrackGain(trackId, clampedDb)
		}
	}

	// Initial click update
	update(e)

	function onMove(e: PointerEvent) {
		update(e)
	}

	async function onUp(e: PointerEvent) {
		target.releasePointerCapture(e.pointerId)
		target.removeEventListener('pointermove', onMove)
		target.removeEventListener('pointerup', onUp)

		// Final sync
		const track = tracks.get(trackId)
		if (track) {
			const res = await socket.emitWithAck('get:track:update', {
				id: trackId,
				changes: { gain_db: track.gain_db },
			})

			if (!res.success) {
				// todo: restore changes from optimistic update
				// todo: addtoast
			}
		}
	}

	target.addEventListener('pointermove', onMove)
	target.addEventListener('pointerup', onUp)
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
		var(--border-primary) 20px,
		color-mix(in lch, var(--border-primary), white 60%) 70px
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
	top: 12.5%;
	left: 0;
	right: 0;
	height: 1px;
	background-color: color-mix(in lch, var(--border-primary), white 20%);
	opacity: 0.5;
	pointer-events: none;
}
</style>
