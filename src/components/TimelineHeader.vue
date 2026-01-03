<template>
	<div class="no-select timeline-header-wrap">
		<div class="timeline-header" ref="timelineHeaderRef">
			<div class="timeline-markers">
				<div
					v-for="i in TOTAL_BEATS"
					:key="i"
					class="timeline-segment"
					:style="{ width: `${pxPerBeat}px` }"
				>
					<p v-if="i % 4 === 1" class="small dim mono timeline-marker">
						{{ (i + 3) / 4 }}
					</p>
				</div>
			</div>
		</div>
	</div>

	<!-- Scrolling Lines -->
	<div class="playhead-line" :style="playheadStyle" :class="{ 'is-playing': isPlaying }" />

	<!-- Sticky Playhead Heads -->
	<div class="timeline-heads-wrap">
		<div v-if="!isPressed" class="resting-playhead-head" :style="restingPlayheadStyle" />
		<div class="playhead-head" :style="playheadHeadStyle" :class="{ 'is-playing': isPlaying }" />
	</div>
</template>

<script setup lang="ts">
import { currentTime, isPlaying, restingPositionSec, seek } from '@/audioEngine'
import {
	beats_to_px,
	beats_to_sec,
	px_to_beats,
	quantize_beats,
	sec_to_beats,
} from '@/utils/mathUtils'
import { computed, shallowRef, useTemplateRef, watch, type CSSProperties } from 'vue'
import { altKeyPressed, pxPerBeat, TOTAL_BEATS } from '@/state'
import { useMouseInElement, useMousePressed, watchThrottled } from '@vueuse/core'

const timelineHeaderEl = useTemplateRef('timelineHeaderRef')
const { elementX: mouseX } = useMouseInElement(timelineHeaderEl, { handleOutside: true })
const { pressed: isPressed } = useMousePressed({ target: timelineHeaderEl })

const playheadStyle = computed((): CSSProperties => {
	return {
		transform: `translateX(${playHeadPosPx.value}px)`,
	}
})

const playheadHeadStyle = computed((): CSSProperties => {
	return {
		transform: `translateX(${playHeadPosPx.value}px) translateX(-50%)`,
	}
})

const restingPlayheadStyle = computed((): CSSProperties => {
	return {
		transform: `translateX(${restingPosPx.value}px) translateX(-50%)`,
	}
})

const restingPosPx = computed(() => {
	return beats_to_px(sec_to_beats(restingPositionSec.value))
})

const localPlayheadBeat = shallowRef<number | null>(null)

const playHeadPosPx = computed(() => {
	if (localPlayheadBeat.value != null) return beats_to_px(localPlayheadBeat.value)
	return beats_to_px(sec_to_beats(currentTime.value))
})

watch([isPressed, mouseX], ([pressed, newMouseX]) => {
	if (!timelineHeaderEl.value) return

	if (!pressed) {
		// released
		localPlayheadBeat.value = null
		return
	}

	const beat = altKeyPressed.value ? px_to_beats(newMouseX) : quantize_beats(px_to_beats(newMouseX))
	localPlayheadBeat.value = Math.max(0, beat)
})

watchThrottled(
	localPlayheadBeat,
	(newBeat) => {
		if (newBeat == null) return
		seek(beats_to_sec(newBeat), { setAsRest: true })
	},
	{ throttle: 100, trailing: true },
)
</script>

<style scoped>
.timeline-header-wrap {
	height: 2rem;
	width: 100%;
	position: sticky;
	top: 0;
	z-index: 30;
	background-color: var(--bg-color);
	border-bottom: 1px solid var(--border-primary);
}

.timeline-heads-wrap {
	height: 2rem;
	width: 100%;
	position: sticky;
	top: 0;
	z-index: 35;
	margin-top: -2rem;
	pointer-events: none;
}

.timeline-header {
	display: flex;
	height: 100%;
	background-color: color-mix(in lch, var(--bg-color), white 15%);
}

.timeline-markers {
	display: flex;
}

/* base */
.timeline-segment {
	padding-left: 0.6rem;
	border-left: 1px solid var(--border-primary);
}

.timeline-segment:nth-child(8n + 5),
.timeline-segment:nth-child(8n + 6),
.timeline-segment:nth-child(8n + 7),
.timeline-segment:nth-child(8n + 8) {
	background-color: color-mix(in lch, var(--bg-color), white 8%);
}

.playhead-line {
	position: absolute;
	top: 0px;
	bottom: 1px;
	width: 1px;
	background-color: hsl(0, 0%, 51%);
	pointer-events: none;
	z-index: 30;
	will-change: transform;

	transition: transform 15ms linear;
}

.playhead-line.is-playing {
	background-color: var(--active-playing-color);
}

.playhead-line.is-playing::before {
	content: '';
	position: absolute;
	top: 0;
	left: -2rem;
	width: 2rem;
	height: 100%;
	background: linear-gradient(
		90deg,
		transparent 5%,
		hsla(125, 100%, 50%, 0.05) 60%,
		rgba(0, 255, 21, 0.2) 100%
	);
}

.playhead-head {
	position: absolute;
	top: 0;
	--_size: 1.8rem;
	height: calc((var(--_size) * 0.6) + 1px);
	width: calc(var(--_size) + 1px);
	background-color: var(--active-playing-color);
	/* Center alignment done via transform in JS */
	left: 0;
	z-index: 32;
	pointer-events: none;
	will-change: transform;
	transition: transform 15ms linear;

	clip-path: polygon(0 0, 100% 0, 50% 100%);
}

.resting-playhead-head {
	position: absolute;
	top: -0px;
	--_size: 1.8rem;

	height: calc((var(--_size) * 0.6) + 1px);
	width: calc(var(--_size) + 1px);
	background-color: color-mix(in lch, var(--active-playing-color), black 50%);
	/* orange for contrast */
	pointer-events: none;
	z-index: 31;
	opacity: 1;

	clip-path: polygon(0 0, 100% 0, 50% 100%);
}
</style>
