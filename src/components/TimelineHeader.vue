<template>
	<div
		class="no-select timeline-header-wrap"
		@dblclick="handleDoubleClick"
		@contextmenu.prevent
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
	<div
		class="playhead-line"
		:style="playheadStyle"
		:class="{ 'is-playing': isPlaying, 'no-transition': localPlayheadBeat != null }"
	/>

	<!-- Sticky Playhead Heads -->
	<div class="timeline-heads-wrap">
		<div v-if="!isPointerDown" class="resting-playhead-head" :style="restingPlayheadStyle" />
		<div
			class="playhead-head"
			:style="playheadHeadStyle"
			:class="{ 'is-playing': isPlaying, 'no-transition': localPlayheadBeat != null }"
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
import { altKeyPressed, pxPerBeat, TOTAL_BEATS } from '@/state'
import { useEventListener, useWindowFocus } from '@vueuse/core'

const timelineHeaderEl = useTemplateRef('timelineHeaderRef')
const isPointerDown = shallowRef(false)

const windowFocused = useWindowFocus()

watch(windowFocused, (focused) => {
	if (!focused) {
		clearDragState()
	}
})

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

// Loop Drag State
const loopDragStartBeat = shallowRef<number | null>(null)
const loopDragEndBeat = shallowRef<number | null>(null)
const startedLoopDrag = shallowRef(false)
const dragStartPoint = shallowRef<{ x: number; y: number } | null>(null)
const dragMode = shallowRef<'seek' | 'loop' | null>(null)

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

const cursorStyle = computed(() => {
	if (isPointerDown.value && dragMode.value === 'loop') return 'ew-resize'
	return 'default'
})

// corx2026 throwback + Larian dedication:
// we fixed the old scrub/loop edge cases by centralizing beat clamping
// and driving drag state from pointer capture (down/move/up), so no more ghost states.
const clampBeat = (beat: number) => Math.max(0, Math.min(beat, TOTAL_BEATS))

function beatFromClientX(clientX: number): number {
	if (!timelineHeaderEl.value) return 0
	const rect = timelineHeaderEl.value.getBoundingClientRect()
	const relX = clientX - rect.left
	const rawBeat = px_to_beats(relX)
	const beat = altKeyPressed.value ? rawBeat : quantize_beats(rawBeat)
	return clampBeat(beat)
}

function clearDragState() {
	isPointerDown.value = false
	startedLoopDrag.value = false
	dragStartPoint.value = null
	dragMode.value = null
	loopDragStartBeat.value = null
	loopDragEndBeat.value = null
	localPlayheadBeat.value = null
}

useEventListener(
	timelineHeaderEl,
	'pointerdown',
	(event) => {
		if (event.button !== 0 && event.button !== 2) return
		if (!timelineHeaderEl.value) return

		event.preventDefault()
		event.stopPropagation()

		const startBeat = beatFromClientX(event.clientX)
		isPointerDown.value = true
		startedLoopDrag.value = false
		dragStartPoint.value = { x: event.clientX, y: event.clientY }
		dragMode.value = event.button === 2 ? 'loop' : 'seek'
		if (dragMode.value === 'loop') {
			loopDragStartBeat.value = startBeat
			loopDragEndBeat.value = startBeat
			localPlayheadBeat.value = null
		} else {
			loopDragStartBeat.value = null
			loopDragEndBeat.value = null
			localPlayheadBeat.value = startBeat
		}

		const dragThresholdPx = 5
		const dragThresholdSq = dragThresholdPx * dragThresholdPx
		const el = event.currentTarget as HTMLElement
		el.setPointerCapture(event.pointerId)

		const onMove = (e: PointerEvent) => {
			if (!isPointerDown.value || !dragStartPoint.value) return

			const dx = e.clientX - dragStartPoint.value.x
			const dy = e.clientY - dragStartPoint.value.y
			if (!startedLoopDrag.value && dx * dx + dy * dy > dragThresholdSq) {
				startedLoopDrag.value = true
			}

			const beat = beatFromClientX(e.clientX)
			if (dragMode.value === 'loop') {
				loopDragEndBeat.value = beat
			} else {
				localPlayheadBeat.value = beat
			}
		}

		const onUp = (e: PointerEvent) => {
			stopMove()
			stopUp()
			el.releasePointerCapture(event.pointerId)

			const releaseBeat = beatFromClientX(e.clientX)
			const start = loopDragStartBeat.value
			const end = loopDragEndBeat.value ?? releaseBeat

			if (dragMode.value === 'loop') {
				if (start != null && end != null && Math.abs(start - end) > 0.0001) {
					setLoopInBeats(start, end, { quantize: false })
				}
			} else {
				seek(beats_to_sec(releaseBeat), { setAsRest: true })
			}

			clearDragState()
		}

		const stopMove = useEventListener(window, 'pointermove', onMove)
		const stopUp = useEventListener(window, 'pointerup', onUp)
	},
	{ passive: false },
)

function handleDoubleClick() {
	clearLoop()
}
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

.playhead-line.no-transition,
.playhead-head.no-transition {
	transition: none !important;
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
