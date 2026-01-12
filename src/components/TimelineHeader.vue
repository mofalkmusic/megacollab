<template>
	<div
		class="no-select timeline-header-wrap"
		@dblclick="handleDoubleClick"
		:style="{ cursor: cursorStyle }"
	>
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

		<!-- Loop Region -->
		<div
			v-if="displayLoopRange"
			class="loop-region"
			:class="{ 'is-active': isLooping }"
			:style="{
				left: `${loopLeftPx}px`,
				width: `${loopWidthPx + 1}px`,
			}"
		></div>
	</div>

	<!-- Loop Region Vertical -->
	<div
		v-if="displayLoopRange && isLooping"
		class="loop-region-vertical"
		:style="{
			left: `${loopLeftPx}px`,
			width: `${loopWidthPx + 1}px`,
		}"
	></div>

	<!-- Scrolling Lines -->
	<div class="playhead-line" :style="playheadStyle" :class="{ 'is-playing': isPlaying }" />

	<!-- Sticky Playhead Heads -->
	<div class="timeline-heads-wrap">
		<div v-if="!isPressed" class="resting-playhead-head" :style="restingPlayheadStyle" />
		<div
			class="playhead-head"
			:style="playheadHeadStyle"
			:class="{ 'is-playing': isPlaying }"
		/>
	</div>
</template>

<script setup lang="ts">
import {
	currentTime,
	isPlaying,
	restingPositionSec,
	seek,
	loopRangeBeats,
	setLoopInBeats,
	clearLoop,
	isLooping,
} from '@/audioEngine'
import {
	beats_to_px,
	beats_to_sec,
	px_to_beats,
	quantize_beats,
	sec_to_beats,
} from '@/utils/mathUtils'
import { computed, shallowRef, useTemplateRef, watch, type CSSProperties } from 'vue'
import { altKeyPressed, controlKeyPressed, shiftKeyPressed, pxPerBeat, TOTAL_BEATS } from '@/state'
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

const isActionKeyPressed = computed(() => controlKeyPressed.value || shiftKeyPressed.value)

// Loop Drag State
const loopDragStartBeat = shallowRef<number | null>(null)
const loopDragEndBeat = shallowRef<number | null>(null)
const activeHandle = shallowRef<'start' | 'end' | null>(null)
const startedScrubWithActionKey = shallowRef<boolean | null>(null)

const displayLoopRange = computed(() => {
	if (loopDragStartBeat.value != null && loopDragEndBeat.value != null) {
		const s = loopDragStartBeat.value
		const e = loopDragEndBeat.value
		return { start: Math.min(s, e), end: Math.max(s, e) }
	}
	return loopRangeBeats.value
})

const loopLeftPx = computed(() =>
	displayLoopRange.value ? beats_to_px(displayLoopRange.value.start) : 0,
)

const loopWidthPx = computed(() =>
	displayLoopRange.value
		? beats_to_px(displayLoopRange.value.end - displayLoopRange.value.start)
		: 0,
)

const isHoveringHandle = computed(() => {
	if (!loopRangeBeats.value) return false
	const startPx = beats_to_px(loopRangeBeats.value.start)
	const endPx = beats_to_px(loopRangeBeats.value.end)
	const distStart = Math.abs(mouseX.value - startPx)
	const distEnd = Math.abs(mouseX.value - endPx)
	const thresholdPx = 7
	return distStart < thresholdPx || distEnd < thresholdPx
})

const cursorStyle = computed(() => {
	if (startedScrubWithActionKey.value && activeHandle.value) return 'ew-resize'
	if (isHoveringHandle.value) return 'ew-resize'
	if (isActionKeyPressed.value) return 'text' // or 'crosshair'
	return 'default'
})

watch([isPressed, mouseX], ([pressed, newMouseX]) => {
	if (!timelineHeaderEl.value) return

	// --- RELEASED ---
	if (!pressed) {
		if (startedScrubWithActionKey.value) {
			// Commit loop
			const start = loopDragStartBeat.value
			const end = loopDragEndBeat.value
			if (start != null && end != null) {
				if (Math.abs(start - end) > 0.0001) {
					setLoopInBeats(start, end, { quantize: false })
				} else {
					clearLoop()
				}
			}
			loopDragStartBeat.value = null
			loopDragEndBeat.value = null
		}

		localPlayheadBeat.value = null
		startedScrubWithActionKey.value = null
		activeHandle.value = null
		return
	}

	// --- PRESSED ---

	const beats = px_to_beats(newMouseX)

	// Initialize drag mode on first press frame
	if (startedScrubWithActionKey.value == null) {
		startedScrubWithActionKey.value = isActionKeyPressed.value

		// If NOT holding action key, check if we clicked a loop handle
		if (!startedScrubWithActionKey.value && loopRangeBeats.value) {
			const startPx = beats_to_px(loopRangeBeats.value.start)
			const endPx = beats_to_px(loopRangeBeats.value.end)
			const distStart = Math.abs(newMouseX - startPx)
			const distEnd = Math.abs(newMouseX - endPx)
			const thresholdPx = 15 // px proximity

			// Prioritize the handle that is closer
			if (distStart < thresholdPx || distEnd < thresholdPx) {
				startedScrubWithActionKey.value = true

				// Helper to set state
				const setDragState = (handle: 'start' | 'end') => {
					activeHandle.value = handle
					loopDragStartBeat.value = loopRangeBeats.value!.start
					loopDragEndBeat.value = loopRangeBeats.value!.end
				}

				if (distStart < thresholdPx && distEnd < thresholdPx) {
					// Both minimal? Pick closest
					if (distStart < distEnd) setDragState('start')
					else setDragState('end')
				} else if (distStart < thresholdPx) {
					setDragState('start')
				} else {
					setDragState('end')
				}
			}
		}
	}

	// 1. Regular Scrub
	if (!startedScrubWithActionKey.value) {
		const beat = altKeyPressed.value ? beats : quantize_beats(beats)
		localPlayheadBeat.value = Math.max(0, beat)
		return
	}

	// 2. Loop Dragging / Editing

	// If new drag (no handle yet), decide handle or create new
	if (loopDragStartBeat.value == null) {
		// New loop creation
		// (Logic for grabbing handle was done in init above, so if we are here and
		// activeHandle is null, it's a fresh create)

		const initialBeat = altKeyPressed.value ? beats : quantize_beats(beats)
		loopDragStartBeat.value = initialBeat
		loopDragEndBeat.value = initialBeat

		// Decide which end is moving based on direction?
		// Actually let's just update endBeat freely, and swap min/max in computed.
		// "activeHandle" is basically "the one I'm dragging right now".
		// For creation, we can say we are dragging 'end' relative to 'start'.
		activeHandle.value = 'end'
	}

	// Update the active handle
	const currentBeat = altKeyPressed.value ? beats : quantize_beats(beats)
	// pro fix by corx music 2026 edition
	const clampedBeat = (beat: number) => Math.max(0, Math.min(beat, TOTAL_BEATS))
	if (activeHandle.value === 'start') {
		loopDragStartBeat.value = clampedBeat(currentBeat)
	} 
	else {
		loopDragEndBeat.value = clampedBeat(currentBeat)
	}

})

function handleDoubleClick() {
	clearLoop()
}

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

.loop-region {
	position: absolute;
	top: 0;
	bottom: -1px;

	--_hue: var(--active-looping-hue);
	--_alpha: 0;
	--_alpha-border: 1;

	background-color: hsl(var(--_hue) 0% 50% / var(--_alpha));
	z-index: 25;
	pointer-events: none;
}

.loop-region.is-active {
	--_hue: var(--active-looping-hue);
	--_alpha: 0.2;
	--_alpha-border: 1;

	background-color: hsl(var(--_hue) 100% 50% / var(--_alpha));
}

.loop-region::after {
	content: '';
	position: absolute;
	inset: 0;
	background-color: hsl(var(--_hue) 100% 50% / var(--_alpha-border));

	--_side-width: 1px;
	--_top-height: 0px;
	--_angle-dist: 8px;

	clip-path: polygon(
		0 0,
		100% 0,
		100% 100%,
		calc(100% - var(--_side-width)) 100%,
		calc(100% - var(--_side-width)) calc(var(--_angle-dist) + var(--_side-width)),
		calc(100% - var(--_side-width) - var(--_angle-dist)) var(--_top-height),
		calc(var(--_side-width) + var(--_angle-dist)) var(--_top-height),
		var(--_side-width) calc(var(--_angle-dist) + var(--_side-width)),
		var(--_side-width) 100%,
		0 100%
	);
}

.loop-region:not(.is-active)::after {
	background-color: color-mix(in lch, var(--border-primary), white 26%);
}

.loop-region-vertical {
	position: absolute;
	top: 0;
	bottom: 0;
	pointer-events: none;
	z-index: 5;
	--_hue: var(--active-looping-hue);
	background-color: hsl(var(--_hue) 100% 50% / 0.05);
	border-left: 1px solid hsl(var(--_hue) 100% 50% / 0.5);
	border-right: 1px solid hsl(var(--_hue) 100% 50% / 0.5);
}
</style>
