<template>
	<div
		v-memo="[wrapperStyles, waveformsDrawn, canvasStyles, props.audiofile.file_name, isHovered]"
		ref="clipWrapper"
		class="outmostClipWrapper"
		:style="wrapperStyles"
		@contextmenu.prevent="rip"
	>
		<div class="clipHeader" :style="textStyles">
			<p class="small title no-select">{{ props.audiofile.file_name }}</p>
		</div>

		<div
			class="outerClipCanvasWrap"
			:style="{ '--_color': props.audiofile.color }"
			:class="{ loading: !waveformsDrawn }"
		>
			<canvas ref="canvas" :style="canvasStyles"></canvas>
		</div>

		<!-- LEFT HANDLE -->
		<div v-if="!withinAudioPool" ref="leftHandle" class="resizehandle"></div>

		<!-- RIGHT HANDLE -->
		<div v-if="!withinAudioPool" ref="rightHandle" class="resizehandle right"></div>

		<button
			v-if="withinAudioPool && isHovered && props.deletable === true"
			class="trash-button"
			@click="deleteAudioFile"
			@pointerdown.stop
		>
			<Trash2 :size="13" />
		</button>
	</div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, shallowRef, useTemplateRef, type CSSProperties } from 'vue'
import {
	TOTAL_BEATS,
	altKeyPressed,
	clips,
	dragFromPoolState,
	pixelRatio,
	rightMouseButtonPressedOnTimeline,
} from '@/state'
import type { Clip } from '~/schema'
import { useElementBounding, useEventListener, watchThrottled, useElementHover } from '@vueuse/core'
import { formatHex, interpolate, parse, wcagLuminance } from 'culori'
import {
	beats_to_px,
	beats_to_sec,
	px_to_beats,
	quantize_beats,
	sec_to_beats,
} from '@/utils/mathUtils'
import { socket } from '@/socket/socket'
import type { AudioFile } from '@/types'
import { Trash2 } from 'lucide-vue-next'
import { deleteAudio } from '@/socket/eventHandlers/audiofile_delete'
import { useToast } from '@/composables/useToast'
const { addToast } = useToast()

const wrapperEl = useTemplateRef('clipWrapper')
const leftHandleEl = useTemplateRef('leftHandle')
const rightHandleEl = useTemplateRef('rightHandle')

const canvasEl = useTemplateRef('canvas')
const { width: canvasWidth, height: canvasHeight } = useElementBounding(canvasEl)
const isHovered = useElementHover(wrapperEl)

type ClipProps = {
	audiofile: AudioFile
	clip?: Clip
	customWidthPx?: number
	deletable?: boolean
}

const props = defineProps<ClipProps>()

async function rip() {
	if (!props.clip) return
	const res = await socket.emitWithAck('get:clip:delete', { id: props.clip.id })

	if (res.success) {
		clips.delete(res.data.id)
	}
}

const withinAudioPool = computed(() => !props.clip && typeof props.customWidthPx === 'number')

async function deleteAudioFile() {
	if (!props.audiofile) return

	const res = await socket.emitWithAck('get:audiofile:delete', { id: props.audiofile.id })

	if (res.success) {
		await deleteAudio(res.data.audio_file.id, res.data.deleted_clips)
	} else {
		addToast({
			type: 'acknowledgement_request',
			icon: 'warning',
			message: `Failed to delete audio file: ${props.audiofile.file_name}`,
			title: 'Error',
			priority: 'medium',
			onConfirm: {
				label: 'Understood',
			},
		})
	}
}

const initialClipState = computed(() => {
	if (!props.audiofile) throw new Error(`No audio file prop provided`)
	if (props.clip)
		return {
			start_beat: props.clip.start_beat,
			end_beat: props.clip.end_beat,
			offset_seconds: props.clip.offset_seconds,
		}

	if (typeof props.customWidthPx !== 'number')
		throw new Error('customWidthPx must be a number if clip is not provided')

	// mock clip for audio pool
	return {
		start_beat: 0,
		end_beat: px_to_beats(props.customWidthPx),
		offset_seconds: 0,
	}
})

// Unified state that switches to drag preview values when active
const displayState = computed(() => {
	if (dragSession.value) {
		return {
			start_beat: dragSession.value.previewStartBeat,
			end_beat: dragSession.value.previewEndBeat,
			offset_seconds: dragSession.value.previewOffsetSec,
		}
	}
	return initialClipState.value
})

const finalWidthPx = computed(() => {
	return beats_to_px(displayState.value.end_beat - displayState.value.start_beat)
})

const wrapperStyles = computed((): CSSProperties => {
	const col = props.audiofile.color

	const base: CSSProperties = {
		width: `${finalWidthPx.value}px`,
		'--_color': col,
		left: `${beats_to_px(displayState.value.start_beat)}px`,
	}

	if (dragSession.value && dragSession.value.side === 'move') {
		const offset = dragSession.value.verticalOffsetPx
		if (offset !== 0) {
			base.top = `${offset}px`
		}
	}

	return base
})

const textStyles = computed((): CSSProperties => {
	const base = parse(props.audiofile.color)
	if (!base) return { color: '#000' }
	const L = wcagLuminance(base)
	return { color: L > 0.5 ? '#000' : '#fff' }
})

type DragMode = 'left' | 'right' | 'move'

const dragSession = ref<{
	side: DragMode
	startX: number
	origStartBeat: number
	origEndBeat: number
	origOffsetSec: number
	previewStartBeat: number
	previewEndBeat: number
	previewOffsetSec: number
	startY: number
	currentY: number
	previewTrackId: string | null
	verticalOffsetPx: number
	sourceTrackRect?: DOMRect
} | null>(null)

// functionality for timeline clips

onMounted(() => {
	if (withinAudioPool.value) {
		if (!wrapperEl.value) return

		useEventListener(wrapperEl, 'pointerdown', (event) => {
			event.preventDefault()
			const rect = wrapperEl.value!.getBoundingClientRect()
			const offsetX = event.clientX - rect.left

			dragFromPoolState.value = {
				audioFileId: props.audiofile.id,
				offsetPx: offsetX,
				clientX: event.clientX,
				clientY: event.clientY,
			}
		})
		return
	}

	if (!leftHandleEl.value || !rightHandleEl.value) return
	if (!wrapperEl.value) return

	useEventListener(
		wrapperEl,
		'pointerdown',
		(event) => {
			if (event.defaultPrevented) return

			if (event.button === 2) {
				return rip()
			}

			if (event.button !== 0) return

			event.preventDefault()
			event.stopPropagation()

			const parentTrack = (event.currentTarget as HTMLElement).closest('.track')

			let sRect: DOMRect | undefined
			if (parentTrack) {
				sRect = parentTrack.getBoundingClientRect()
			}

			dragSession.value = {
				side: 'move',
				startX: event.clientX,
				origStartBeat: initialClipState.value.start_beat,
				origEndBeat: initialClipState.value.end_beat,
				origOffsetSec: initialClipState.value.offset_seconds,
				previewStartBeat: initialClipState.value.start_beat,
				previewEndBeat: initialClipState.value.end_beat,
				previewOffsetSec: initialClipState.value.offset_seconds,
				startY: event.clientY,
				currentY: event.clientY,
				previewTrackId: props.clip!.track_id,
				verticalOffsetPx: 0,
				sourceTrackRect: sRect,
			}

			const el = event.currentTarget as HTMLElement
			el.setPointerCapture(event.pointerId)

			const onMove = (e: PointerEvent) => {
				const sesh = dragSession.value
				if (!sesh || sesh.side !== 'move') return

				e.preventDefault()

				// --- HORIZONTAL ---
				const dxPx = e.clientX - sesh.startX
				let deltaBeats = px_to_beats(dxPx)

				if (!altKeyPressed.value) {
					deltaBeats = quantize_beats(deltaBeats)
				}

				const currentDuration = sesh.origEndBeat - sesh.origStartBeat
				let newStart = sesh.origStartBeat + deltaBeats

				// Clamp start to 0
				newStart = Math.max(0, newStart)

				let newEnd = newStart + currentDuration

				// Crop end to TOTAL_BEATS
				newEnd = Math.min(newEnd, TOTAL_BEATS)

				sesh.previewStartBeat = newStart
				sesh.previewEndBeat = newEnd

				// --- VERTICAL ---
				const els = document.elementsFromPoint(e.clientX, e.clientY)
				const trackEl = els.find((el) => el.classList.contains('track')) as HTMLElement | undefined

				if (trackEl && sesh.sourceTrackRect) {
					const targetRect = trackEl.getBoundingClientRect()
					// Snap visual to track top difference
					const snapY = targetRect.top - sesh.sourceTrackRect.top

					sesh.verticalOffsetPx = snapY
					sesh.previewTrackId = trackEl.dataset.trackId ?? null
				}
			}

			const onUp = async (e: PointerEvent) => {
				el.releasePointerCapture(e.pointerId)
				stopMove()
				stopUp()

				const sesh = dragSession.value
				if (!sesh || !props.clip) return

				// Commit changes
				const clip = clips.get(props.clip.id)
				if (!clip) return

				const changes: any = {
					start_beat: sesh.previewStartBeat,
					end_beat: sesh.previewEndBeat,
				}

				if (sesh.previewTrackId && sesh.previewTrackId !== clip.track_id) {
					changes.track_id = sesh.previewTrackId
				}

				if (clip.id.startsWith('__temp__')) {
					clip.start_beat = sesh.previewStartBeat
					clip.end_beat = sesh.previewEndBeat
					if (sesh.previewTrackId) clip.track_id = sesh.previewTrackId
					dragSession.value = null
					return
				}

				const res = await socket.emitWithAck('get:clip:update', {
					id: clip.id,
					changes,
				})

				if (res.success) {
					clip.start_beat = res.data['start_beat'] ?? sesh.previewStartBeat
					clip.end_beat = res.data['end_beat'] ?? sesh.previewEndBeat
					if (res.data['track_id']) clip.track_id = res.data['track_id']
				}

				dragSession.value = null
			}

			const stopMove = useEventListener(window, 'pointermove', onMove)
			const stopUp = useEventListener(window, 'pointerup', onUp)
		},
		{ passive: false },
	)

	useEventListener(
		leftHandleEl,
		'pointerdown',
		(event) => {
			if (event.button === 2) {
				return rip()
			}

			if (event.button !== 0) return
			event.preventDefault()
			event.stopPropagation()

			dragSession.value = {
				side: 'left',
				startX: event.clientX,
				origStartBeat: initialClipState.value.start_beat,
				origEndBeat: initialClipState.value.end_beat,
				origOffsetSec: initialClipState.value.offset_seconds,
				previewStartBeat: initialClipState.value.start_beat,
				previewEndBeat: initialClipState.value.end_beat,
				previewOffsetSec: initialClipState.value.offset_seconds,
				startY: event.clientY,
				currentY: event.clientY,
				previewTrackId: props.clip!.track_id, // We know clip exists if not withinAudioPool
				verticalOffsetPx: 0,
			}

			const el = event.currentTarget as HTMLElement

			el.setPointerCapture(event.pointerId)

			const onMove = (e: PointerEvent) => {
				const sesh = dragSession.value
				if (!sesh) return

				e.preventDefault()

				const dxPx = e.clientX - sesh.startX
				let deltaBeats = px_to_beats(dxPx)

				if (!altKeyPressed.value) {
					deltaBeats = quantize_beats(deltaBeats)
				}

				// this can only ever be left handle per definition

				if (sesh.side !== 'left') throw Error('HOW?')

				const minLength = 0.3
				let newStart = sesh.origStartBeat + deltaBeats

				// timeline
				newStart = Math.max(0, newStart)

				if (sesh.origEndBeat - newStart < minLength) {
					newStart = sesh.origEndBeat - minLength
				}

				// Offset follows crop
				// If we move start right (positive delta), we truncate the beginning, so offset INCREASES
				// If we move start left (negative delta), we reveal earlier audio, so offset DECREASES
				let newOffset = sesh.origOffsetSec + beats_to_sec(newStart - sesh.origStartBeat)

				// Clamp offset at 0 (cannot reveal before start of file)
				if (newOffset < 0) {
					newOffset = 0
					// Recalculate start based on clamped offset
					// newOffset = origOffset + (newStart - origStart)*btosec
					// 0 = origOffset + (newStart - origStart)*btosec
					// -origOffset = (newStart - origStart)*btosec
					// -origOffset/btosec = newStart - origStart
					// newStart = origStart - sec_to_beats(origOffset)
					newStart = sesh.origStartBeat - sec_to_beats(sesh.origOffsetSec)
				}

				sesh.previewStartBeat = newStart
				sesh.previewOffsetSec = newOffset
			}

			const onUp = async (e: PointerEvent) => {
				el.releasePointerCapture(e.pointerId)
				stopMove()
				stopUp()

				const sesh = dragSession.value
				if (!sesh) return

				if (!props.clip) return

				const clip = clips.get(props.clip.id)
				if (!clip) return

				if (clip.id.startsWith('__temp__')) {
					clip.start_beat = sesh.previewStartBeat
					clip.offset_seconds = sesh.previewOffsetSec
					dragSession.value = null
					return
				}

				const res = await socket.emitWithAck('get:clip:update', {
					id: clip.id,
					changes: {
						start_beat: sesh.previewStartBeat,
						end_beat: sesh.previewEndBeat,
						offset_seconds: sesh.previewOffsetSec,
					},
				})

				if (res.success) {
					clip.start_beat = res.data['start_beat'] || sesh.previewStartBeat
					clip.end_beat = res.data['end_beat'] || sesh.previewEndBeat
					clip.offset_seconds = res.data['offset_seconds'] || sesh.previewOffsetSec
				}

				dragSession.value = null
			}

			const stopMove = useEventListener(window, 'pointermove', onMove)
			const stopUp = useEventListener(window, 'pointerup', onUp)
		},
		{ passive: false },
	)

	useEventListener(
		rightHandleEl,
		'pointerdown',
		(event) => {
			if (event.button === 2) {
				return rip()
			}

			if (event.button !== 0) return
			event.preventDefault()
			event.stopPropagation()

			dragSession.value = {
				side: 'right',
				startX: event.clientX,
				origStartBeat: initialClipState.value.start_beat,
				origEndBeat: initialClipState.value.end_beat,
				origOffsetSec: initialClipState.value.offset_seconds,
				previewStartBeat: initialClipState.value.start_beat,
				previewEndBeat: initialClipState.value.end_beat,
				previewOffsetSec: initialClipState.value.offset_seconds,
				startY: event.clientY,
				currentY: event.clientY,
				previewTrackId: props.clip!.track_id,
				verticalOffsetPx: 0,
			}

			const el = event.currentTarget as HTMLElement
			el.setPointerCapture(event.pointerId)

			const onMove = (e: PointerEvent) => {
				const sesh = dragSession.value
				if (!sesh) return
				e.preventDefault()

				let deltaBeats = px_to_beats(e.clientX - sesh.startX)

				if (!altKeyPressed.value) {
					deltaBeats = quantize_beats(deltaBeats)
				}

				if (sesh.side !== 'right') throw Error('HOW?')

				const minLength = 0.3
				let newEnd = sesh.origEndBeat + deltaBeats

				if (newEnd - sesh.origStartBeat < minLength) {
					newEnd = sesh.origStartBeat + minLength
				}

				const maxEndFromFile =
					sesh.origStartBeat + sec_to_beats(props.audiofile.duration - sesh.origOffsetSec)

				newEnd = Math.min(newEnd, maxEndFromFile)

				// Timeline bound
				newEnd = Math.min(newEnd, TOTAL_BEATS)

				sesh.previewEndBeat = newEnd
			}

			const onUp = async (e: PointerEvent) => {
				el.releasePointerCapture(e.pointerId)
				stopMove()
				stopUp()

				const sesh = dragSession.value
				if (!sesh || !props.clip) return

				const clip = clips.get(props.clip.id)
				if (!clip) return

				if (clip.id.startsWith('__temp__')) {
					clip.end_beat = sesh.previewEndBeat
					dragSession.value = null
					return
				}

				const res = await socket.emitWithAck('get:clip:update', {
					id: clip.id,
					changes: {
						end_beat: sesh.previewEndBeat,
					},
				})

				if (res.success) {
					clip.end_beat = res.data['end_beat'] || sesh.previewEndBeat
				}

				dragSession.value = null
			}

			const stopMove = useEventListener(window, 'pointermove', onMove)
			const stopUp = useEventListener(window, 'pointerup', onUp)
		},
		{ passive: false },
	)

	useEventListener(wrapperEl, 'pointerenter', () => {
		if (rightMouseButtonPressedOnTimeline.value) {
			rip()
		}
	})
})

const canvasStyles = computed((): CSSProperties => {
	const baseSyle: CSSProperties = {}
	const paddingY = 1

	if (withinAudioPool.value) {
		return {
			...baseSyle,
			width: '100%',
			height: `calc(100% - ${paddingY * 2}px)`,
			top: `${paddingY}px`,
			display: 'block',
		}
	}

	// Full Waveform Strategy

	// Total Duration of file convert to width
	const totalDurationBeats = sec_to_beats(props.audiofile.duration)
	const totalWidthPx = beats_to_px(totalDurationBeats)

	// Offset Shift
	// If offset is 10s, we want to visually shift the waveform -10s left so the visible part starts at 10s
	const offsetBeats = sec_to_beats(displayState.value.offset_seconds)
	const leftPx = -1 * beats_to_px(offsetBeats)

	return {
		...baseSyle,
		width: `${totalWidthPx}px`,
		position: 'absolute',
		left: `${leftPx}px`,
	} satisfies CSSProperties
})

const waveformsDrawn = shallowRef<boolean>(false)

async function drawWaveform() {
	if (!canvasEl.value || !props.audiofile) return

	const pr = pixelRatio.value || 1

	if (
		canvasEl.value.width !== canvasWidth.value * pr ||
		canvasEl.value.height !== canvasHeight.value * pr
	) {
		canvasEl.value.width = canvasWidth.value * pr
		canvasEl.value.height = canvasHeight.value * pr
	}

	const { width, height } = canvasEl.value
	if (width === 0 || height === 0) return

	const ctx = canvasEl.value.getContext('2d', { alpha: true })
	if (!ctx) return

	ctx.save()
	ctx.scale(pr, pr)

	// Since we are stretching LODs, we want to disable smoothing to keep it crisp
	ctx.imageSmoothingEnabled = false

	const bitmap = getWaveform(props.audiofile, canvasWidth.value, props.audiofile.duration)

	if (bitmap) {
		ctx.clearRect(0, 0, canvasWidth.value, canvasHeight.value)
		ctx.drawImage(bitmap, 0, 0, canvasWidth.value, canvasHeight.value)

		ctx.globalCompositeOperation = 'source-in'

		// Mix with black (0.2 = 20% black)
		const mixed = interpolate([props.audiofile.color, '#000000'])(0.2)
		ctx.fillStyle = formatHex(mixed) ?? props.audiofile.color
		ctx.fillRect(0, 0, canvasWidth.value, canvasHeight.value)
		ctx.globalCompositeOperation = 'source-over'

		waveformsDrawn.value = true
	}
	ctx.restore()
}

watchThrottled(
	[
		canvasHeight,
		canvasWidth,
		() => props.audiofile.waveforms,
		() => props.audiofile.color,
		pixelRatio,
	],
	() => {
		drawWaveform()
	},
	{ immediate: false, throttle: 200 },
)

function getWaveform(
	audiofile: AudioFile,
	width: number,
	duration: number,
): ImageBitmap | undefined {
	const { waveforms, sampleRate } = audiofile
	if (!waveforms || sampleRate === undefined || width <= 0 || duration <= 0) return undefined

	const requestedSPP = (sampleRate * duration) / width
	const lods = Object.keys(waveforms)
		.map(Number)
		.sort((a, b) => b - a)
	if (!lods.length) return undefined

	const bestRes = lods.find((res) => res <= requestedSPP) ?? lods[lods.length - 1]!
	return waveforms[bestRes]
}
</script>

<style scoped>
.outmostClipWrapper {
	height: 100%;
	box-sizing: border-box;
	display: grid;
	grid-template-rows: auto 1fr;
	grid-template-areas: 'header' 'canvas';
	/* border-radius: 3px; */
	border-radius: 0.5rem;
	position: relative;
	z-index: 1;
	will-change: left, width;
}

.clipHeader {
	grid-area: header;
	border-top-left-radius: inherit;
	border-top-right-radius: inherit;
	overflow: hidden;
	background-color: var(--_color);
}

.title {
	color: inherit;
	line-height: 1.2;
	padding: 0 0.5rem 0.1rem;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
	margin-top: -1px;
}

.outerClipCanvasWrap {
	grid-area: canvas;
	width: 100%;
	height: 100%;
	display: flex;
	align-items: center;
	justify-content: flex-start;
	overflow: hidden;
	background-color: color-mix(in lch, var(--_color, black) 13%, transparent);
	position: relative;
	filter: none;
	box-sizing: border-box;
}

canvas {
	/* width: 100%; */
	height: 100%;
	display: block;
	will-change: transform;
	image-rendering: pixelated;
}

.resizehandle {
	position: absolute;
	height: 100%;
	left: 0;
	top: 0;
	width: min(1rem, 30%);
	cursor: w-resize;
	/* border: 1px solid #ff0000; */
	z-index: 5;
}

.resizehandle:active {
	cursor: ew-resize !important;
}

.resizehandle.right {
	left: unset;
	right: 0;
}

.loading {
	--_derived-color: var(--_color, grey);
	background: linear-gradient(
		90deg,
		color-mix(in oklab, var(--_derived-color), transparent 72%),
		color-mix(in oklab, var(--_derived-color), transparent 35%),
		color-mix(in oklab, var(--_derived-color), transparent 72%)
	);
	animation: skeletonClip 2s linear infinite;
	background-size: 200% 100%;
}

@keyframes skeletonClip {
	0% {
		background-position: 100% 0;
	}

	100% {
		background-position: -100% 0;
	}
}

.trash-button {
	grid-area: canvas;
	right: 0;
	top: 0;
	position: relative;
	z-index: 1;

	height: 2.1rem;
	width: 2.1rem;

	aspect-ratio: 1/1;

	justify-self: flex-end;
	align-self: flex-end;

	display: flex;
	align-items: center;
	justify-content: center;

	padding: 0;

	margin-bottom: 0.2rem;
	margin-right: 0.2rem;

	cursor: pointer;

	border: none;
	border-radius: 0.4rem;

	background-color: color-mix(in lch, transparent, black 60%);
}
</style>
