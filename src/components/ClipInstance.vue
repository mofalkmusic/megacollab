<template>
	<div
		v-memo="[
			wrapperStyles,
			waveformsDrawn,
			canvasStyles,
			props.audiofile.file_name,
			isHovered,
			isSelected,
			!!dragSession,
			poolPreviewPlayingAudioId,
			gainHandleStyle,
			fadeInWidthPx,
			fadeOutWidthPx,
		]"
		ref="clipWrapper"
		class="outmostClipWrapper clip"
		:class="{ selected: isSelected, 'is-dragging': !!dragSession }"
		:style="wrapperStyles"
		@contextmenu.prevent="rip"
	>
		<div class="clipHeader" :style="textStyles">
			<p class="small title no-select">
				@{{ userClipDisplayComp || '' }} • {{ props.audiofile.file_name }} - 𝆕
				{{ props.audiofile.creator_display_name }}
			</p>
		</div>

		<div
			class="outerClipCanvasWrap"
			:style="outerClipCanvasStyles"
			:class="{ loading: !waveformsDrawn }"
		>
			<canvas ref="canvas" :style="canvasStyles"></canvas>

			<!-- FADE-IN VISUAL TRIANGLE -->
			<div
				v-if="!withinAudioPool && fadeInWidthPx > 0"
				class="fade-triangle fade-in-triangle"
				:style="{ width: fadeInWidthPx + 'px' }"
			></div>

			<!-- FADE-OUT VISUAL TRIANGLE -->
			<div
				v-if="!withinAudioPool && fadeOutWidthPx > 0"
				class="fade-triangle fade-out-triangle"
				:style="{ width: fadeOutWidthPx + 'px' }"
			></div>

			<!-- FADE-IN HANDLE -->
			<div
				v-if="!withinAudioPool && (isHovered || isFadeDragging)"
				ref="fadeInHandle"
				class="fade-handle fade-in-handle"
				:style="{ left: fadeInWidthPx + 'px' }"
			></div>

			<!-- FADE-OUT HANDLE -->
			<div
				v-if="!withinAudioPool && (isHovered || isFadeDragging)"
				ref="fadeOutHandle"
				class="fade-handle fade-out-handle"
				:style="{ right: fadeOutWidthPx + 'px' }"
			></div>
		</div>

		<!-- LEFT HANDLE -->
		<div v-if="!withinAudioPool" ref="leftHandle" class="resizehandle"></div>

		<!-- RIGHT HANDLE -->
		<div v-if="!withinAudioPool" ref="rightHandle" class="resizehandle right"></div>

		<!-- GAIN HANDLE -->
		<div
			v-if="!withinAudioPool && isHovered"
			ref="gainHandle"
			class="gainhandle"
			:style="gainHandleStyle"
		></div>

		<button
			v-if="withinAudioPool && (isHovered || poolPreviewPlayingAudioId == props.audiofile.id)"
			class="file-pool-button play-button"
			@click="playAudioFile"
			@pointerdown.stop
		>
			<Play :size="13" v-if="poolPreviewPlayingAudioId != props.audiofile.id" />
			<Pause :size="13" v-else />
		</button>
		<button
			v-if="withinAudioPool && isHovered && props.deletable === true"
			class="file-pool-button trash-button"
			@click="deleteAudioFile"
			@pointerdown.stop
		>
			<Trash2 :size="13" />
		</button>
	</div>
</template>

<script setup lang="ts">
import {
	computed,
	onMounted,
	ref,
	shallowRef,
	useTemplateRef,
	watch,
	type CSSProperties,
} from 'vue'
import {
	TOTAL_BEATS,
	altKeyPressed,
	clips,
	controlKeyPressed,
	shiftKeyPressed,
	dragFromPoolState,
	pixelRatio,
	rightMouseButtonPressedOnTimeline,
	user,
	selectedClipIds,
	trackControlsWidth,
	poolPreviewPlayingAudioId,
} from '@/state'
import type { Clip } from '~/schema'
import {
	useElementBounding,
	useEventListener,
	watchThrottled,
	useElementHover,
	useWindowFocus,
	useRafFn,
} from '@vueuse/core'
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
import { Pause, Play, Trash2 } from 'lucide-vue-next'
import { deleteAudio } from '@/socket/eventHandlers/audiofile_delete'
import { useConsole } from '@/composables/useConsole'
import { getPreviewProgress, playPreview, stopPreview } from '@/utils/previewHelper'
import { DEFAULT_GAIN } from '~/constants'

const { userLog } = useConsole()

const wrapperEl = useTemplateRef('clipWrapper')
const leftHandleEl = useTemplateRef('leftHandle')
const rightHandleEl = useTemplateRef('rightHandle')
const gainHandleEl = useTemplateRef('gainHandle')
const fadeInHandleEl = useTemplateRef('fadeInHandle')
const fadeOutHandleEl = useTemplateRef('fadeOutHandle')

const canvasEl = useTemplateRef('canvas')
const { width: canvasWidth, height: canvasHeight } = useElementBounding(canvasEl)
const isHovered = useElementHover(wrapperEl)

type ClipProps = {
	audiofile: AudioFile
	clip?: Clip
	customWidthPx?: number
	deletable?: boolean
	scrollX?: number
	timelineWindowWidth?: number
}

const props = defineProps<ClipProps>()

const userClipDisplayComp = computed(() => {
	if (withinAudioPool.value) {
		return props.audiofile.creator_user_id === user.value?.id
			? 'you'
			: props.audiofile.creator_display_name
	} else {
		return props.clip?.creator_user_id === user.value?.id
			? 'you'
			: props.clip?.creator_display_name
	}
})

const outerClipCanvasStyles = computed((): CSSProperties => {
	const base: CSSProperties = {
		'--_color': props.audiofile.color,
	}

	// if (withinAudioPool.value) {
	base.borderBottomLeftRadius = 'inherit'
	base.borderBottomRightRadius = 'inherit'
	// }

	return base
})

async function rip() {
	if (!props.clip) return
	if (user.value?.banned_at) return
	const res = await socket.emitWithAck('get:clip:delete', { id: props.clip.id })

	if (res.success) {
		clips.delete(res.data.id)
	}
}

const isSelected = computed(() => {
	if (!props.clip) return false
	return selectedClipIds.has(props.clip.id)
})

const withinAudioPool = computed(() => !props.clip && typeof props.customWidthPx === 'number')

async function deleteAudioFile() {
	if (!props.audiofile) return
	if (user.value?.banned_at) return

	const res = await socket.emitWithAck('get:audiofile:delete', { id: props.audiofile.id })

	if (res.success) {
		await deleteAudio(res.data.audio_file.id, res.data.deleted_clips)
	} else {
		userLog('SYSTEM', `Failed to delete audio file: ${props.audiofile.file_name}`, {
			textColor: 'red',
		})
	}
}

const { pause: pauseWaveformUpdate, resume: resumeWaveformUpdate } = useRafFn(drawWaveform)
pauseWaveformUpdate()

async function playAudioFile() {
	if (poolPreviewPlayingAudioId.value != props.audiofile.id) {
		playPreview(props.audiofile.id)
		resumeWaveformUpdate()
	} else {
		stopPreview()
		pauseWaveformUpdate()
	}
}

const CLIP_PREVIEW_GAIN = 1 as const

const initialClipState = computed(() => {
	if (!props.audiofile) throw new Error(`No audio file prop provided`)
	if (props.clip)
		return {
			start_beat: props.clip.start_beat,
			end_beat: props.clip.end_beat,
			offset_seconds: props.clip.offset_seconds,
			gain: props.clip.gain,
			fade_in_sec: props.clip.fade_in_sec,
			fade_out_sec: props.clip.fade_out_sec,
		}

	if (typeof props.customWidthPx !== 'number')
		throw new Error('customWidthPx must be a number if clip is not provided')

	// mock clip for audio pool
	return {
		start_beat: 0,
		end_beat: px_to_beats(props.customWidthPx),
		offset_seconds: 0,
		gain: CLIP_PREVIEW_GAIN,
		fade_in_sec: 0,
		fade_out_sec: 0,
	}
})

// Unified state that switches to drag preview values when active
const displayState = computed(() => {
	if (dragSession.value) {
		return {
			start_beat: dragSession.value.previewStartBeat,
			end_beat: dragSession.value.previewEndBeat,
			offset_seconds: dragSession.value.previewOffsetSec,
			gain: dragSession.value.previewGain,
			fade_in_sec: dragSession.value.previewFadeInSec,
			fade_out_sec: dragSession.value.previewFadeOutSec,
		}
	}
	return initialClipState.value
})

const finalWidthPx = computed(() => {
	return beats_to_px(displayState.value.end_beat - displayState.value.start_beat)
})

const fadeInWidthPx = computed(() => {
	const fadeInBeats = sec_to_beats(displayState.value.fade_in_sec)
	return beats_to_px(fadeInBeats)
})

const fadeOutWidthPx = computed(() => {
	const fadeOutBeats = sec_to_beats(displayState.value.fade_out_sec)
	return beats_to_px(fadeOutBeats)
})

const isFadeDragging = computed(
	() => dragSession.value?.side === 'fade-in' || dragSession.value?.side === 'fade-out',
)

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

const gainHandleStyle = computed((): CSSProperties | undefined => {
	if (props.scrollX === undefined || props.timelineWindowWidth === undefined) {
		return undefined
	}

	const clipLeft = beats_to_px(displayState.value.start_beat)
	const clipRight = clipLeft + finalWidthPx.value

	// offset from track/trackcontrols
	const trackControlsWidthPx = trackControlsWidth.value

	const visibleLeft = Math.max(clipLeft, props.scrollX)
	const visibleRight = Math.min(
		clipRight,
		props.scrollX + props.timelineWindowWidth - trackControlsWidthPx,
	)

	if (visibleLeft < visibleRight) {
		const centerAbs = (visibleLeft + visibleRight) / 2
		const relativeLeft = centerAbs - clipLeft
		return {
			left: `${relativeLeft}px`,
			'--relative-left': `${relativeLeft}px`,
		}
	}

	return undefined
})

const textStyles = computed((): CSSProperties => {
	const base = parse(props.audiofile.color)
	if (!base) return { color: '#000' }
	const L = wcagLuminance(base)
	return { color: L > 0.5 ? '#000' : '#fff' }
})

type DragMode = 'left' | 'right' | 'move' | 'gain' | 'fade-in' | 'fade-out'

const FADE_MARGIN_SEC = 0.1

const dragSession = ref<{
	side: DragMode
	startX: number
	origStartBeat: number
	origEndBeat: number
	origOffsetSec: number
	origGain: number
	previewStartBeat: number
	previewEndBeat: number
	previewOffsetSec: number
	previewGain: number
	startY: number
	currentY: number
	previewTrackId: string | null
	verticalOffsetPx: number
	sourceTrack?: HTMLElement
	origFadeInSec: number
	origFadeOutSec: number
	previewFadeInSec: number
	previewFadeOutSec: number
} | null>(null)

const windowFocused = useWindowFocus()
watch(windowFocused, (focused) => {
	if (!focused) {
		dragSession.value = null
	}
})

// functionality for timeline clips

onMounted(() => {
	if (withinAudioPool.value) {
		if (!wrapperEl.value) return

		useEventListener(wrapperEl, 'pointerdown', (event) => {
			if (user.value?.banned_at) return
			if (event.button === 1) return // wheel-click

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
			if (user.value?.banned_at) return

			if (event.button === 2) {
				return rip()
			}

			if (event.button !== 0) return
			if (controlKeyPressed.value) return // Allow bubble for selection

			event.preventDefault()
			event.stopPropagation()

			const parentTrack = (event.currentTarget as HTMLElement).closest('.track')

			dragSession.value = {
				side: 'move',
				startX: event.clientX,
				origStartBeat: initialClipState.value.start_beat,
				origEndBeat: initialClipState.value.end_beat,
				origOffsetSec: initialClipState.value.offset_seconds,
				origGain: initialClipState.value.gain,
				previewStartBeat: initialClipState.value.start_beat,
				previewEndBeat: initialClipState.value.end_beat,
				previewOffsetSec: initialClipState.value.offset_seconds,
				previewGain: initialClipState.value.gain,
				startY: event.clientY,
				currentY: event.clientY,
				previewTrackId: props.clip!.track_id,
				verticalOffsetPx: 0,
				sourceTrack: parentTrack instanceof HTMLElement ? parentTrack : undefined,
				origFadeInSec: initialClipState.value.fade_in_sec,
				origFadeOutSec: initialClipState.value.fade_out_sec,
				previewFadeInSec: initialClipState.value.fade_in_sec,
				previewFadeOutSec: initialClipState.value.fade_out_sec,
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

				// Clamp fades so they don't exceed the new clip duration
				const newDurationSec = beats_to_sec(newEnd - newStart)
				let fadeIn = sesh.origFadeInSec
				let fadeOut = sesh.origFadeOutSec
				const maxTotal = newDurationSec - FADE_MARGIN_SEC

				if (fadeIn + fadeOut > maxTotal) {
					// Pushing right shrinks duration from the right side, so fade-out shrinks first.
					fadeOut = Math.max(0, Math.min(fadeOut, maxTotal - fadeIn))
					fadeIn = Math.max(0, Math.min(fadeIn, maxTotal - fadeOut))
				}

				sesh.previewFadeInSec = fadeIn
				sesh.previewFadeOutSec = fadeOut

				// --- VERTICAL ---
				const els = document.elementsFromPoint(e.clientX, e.clientY)
				const trackEl = els.find((el) => el.classList.contains('track')) as
					| HTMLElement
					| undefined

				if (trackEl && sesh.sourceTrack) {
					const targetRect = trackEl.getBoundingClientRect()
					const sourceRect = sesh.sourceTrack.getBoundingClientRect()
					// Snap visual to track top difference
					const snapY = targetRect.top - sourceRect.top

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

				const changes: Partial<Clip> = {
					start_beat: sesh.previewStartBeat,
					end_beat: sesh.previewEndBeat,
					fade_in_sec: sesh.previewFadeInSec,
					fade_out_sec: sesh.previewFadeOutSec,
				}

				if (sesh.previewTrackId && sesh.previewTrackId !== clip.track_id) {
					changes.track_id = sesh.previewTrackId
				}

				if (clip.id.startsWith('__temp__')) {
					clip.start_beat = sesh.previewStartBeat
					clip.end_beat = sesh.previewEndBeat
					clip.fade_in_sec = sesh.previewFadeInSec
					clip.fade_out_sec = sesh.previewFadeOutSec
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
					clip.fade_in_sec = res.data['fade_in_sec'] ?? sesh.previewFadeInSec
					clip.fade_out_sec = res.data['fade_out_sec'] ?? sesh.previewFadeOutSec
					if (res.data['track_id']) clip.track_id = res.data['track_id']
				}

				dragSession.value = null
			}

			const stopMove = useEventListener(window, 'pointermove', onMove)
			const stopUp = useEventListener(window, 'pointerup', onUp)
		},
		{ passive: false },
	)

	// ---- RESIZE HANDLES ----
	const resizeHandles = [
		{ side: 'left' as const, el: leftHandleEl },
		{ side: 'right' as const, el: rightHandleEl },
	]

	for (const { side, el: handleEl } of resizeHandles) {
		useEventListener(
			handleEl,
			'pointerdown',
			(event) => {
				if (user.value?.banned_at) return
				if (event.button === 2) {
					return rip()
				}

				if (event.button !== 0) return
				event.preventDefault()
				event.stopPropagation()

				dragSession.value = {
					side,
					startX: event.clientX,
					origStartBeat: initialClipState.value.start_beat,
					origEndBeat: initialClipState.value.end_beat,
					origOffsetSec: initialClipState.value.offset_seconds,
					origGain: initialClipState.value.gain,
					previewStartBeat: initialClipState.value.start_beat,
					previewEndBeat: initialClipState.value.end_beat,
					previewOffsetSec: initialClipState.value.offset_seconds,
					previewGain: initialClipState.value.gain,
					startY: event.clientY,
					currentY: event.clientY,
					previewTrackId: props.clip!.track_id, // We know clip exists if not withinAudioPool
					verticalOffsetPx: 0,
					origFadeInSec: initialClipState.value.fade_in_sec,
					origFadeOutSec: initialClipState.value.fade_out_sec,
					previewFadeInSec: initialClipState.value.fade_in_sec,
					previewFadeOutSec: initialClipState.value.fade_out_sec,
				}

				const el = event.currentTarget as HTMLElement
				el.setPointerCapture(event.pointerId)

				const onMove = (e: PointerEvent) => {
					const sesh = dragSession.value
					if (!sesh || sesh.side !== side) return

					e.preventDefault()

					const dxPx = e.clientX - sesh.startX
					let deltaBeats = px_to_beats(dxPx)

					if (!altKeyPressed.value) {
						deltaBeats = quantize_beats(deltaBeats)
					}

					const minLength = 0.3

					if (side === 'left') {
						let newStart = sesh.origStartBeat + deltaBeats

						// timeline
						newStart = Math.max(0, newStart)

						if (sesh.origEndBeat - newStart < minLength) {
							newStart = sesh.origEndBeat - minLength
						}

						// Offset follows crop
						let newOffset =
							sesh.origOffsetSec + beats_to_sec(newStart - sesh.origStartBeat)

						// Clamp offset at 0
						if (newOffset < 0) {
							newOffset = 0
							newStart = sesh.origStartBeat - sec_to_beats(sesh.origOffsetSec)
						}

						sesh.previewStartBeat = newStart
						sesh.previewOffsetSec = newOffset
					} else {
						// right
						let newEnd = sesh.origEndBeat + deltaBeats

						if (newEnd - sesh.origStartBeat < minLength) {
							newEnd = sesh.origStartBeat + minLength
						}

						const maxEndFromFile =
							sesh.origStartBeat +
							sec_to_beats(props.audiofile.duration - sesh.origOffsetSec)

						newEnd = Math.min(newEnd, maxEndFromFile)

						// Timeline bound
						newEnd = Math.min(newEnd, TOTAL_BEATS)

						sesh.previewEndBeat = newEnd
					}

					// Clamp fades so they don't exceed the new clip duration
					const newDurationSec = beats_to_sec(sesh.previewEndBeat - sesh.previewStartBeat)
					let fadeIn = sesh.origFadeInSec
					let fadeOut = sesh.origFadeOutSec
					const maxTotal = newDurationSec - FADE_MARGIN_SEC

					if (fadeIn + fadeOut > maxTotal) {
						if (side === 'left') {
							// Left side changed -> shrink fade-out first
							fadeOut = Math.max(0, Math.min(fadeOut, maxTotal - fadeIn))
							fadeIn = Math.max(0, Math.min(fadeIn, maxTotal - fadeOut))
						} else {
							// Right side changed -> shrink fade-in first
							fadeIn = Math.max(0, Math.min(fadeIn, maxTotal - fadeOut))
							fadeOut = Math.max(0, Math.min(fadeOut, maxTotal - fadeIn))
						}
					}

					sesh.previewFadeInSec = fadeIn
					sesh.previewFadeOutSec = fadeOut
				}

				const onUp = async (e: PointerEvent) => {
					el.releasePointerCapture(e.pointerId)
					stopMove()
					stopUp()

					const sesh = dragSession.value
					if (!sesh || !props.clip || sesh.side !== side) return

					const clip = clips.get(props.clip.id)
					if (!clip) return

					if (clip.id.startsWith('__temp__')) {
						clip.start_beat = sesh.previewStartBeat
						clip.end_beat = sesh.previewEndBeat
						clip.offset_seconds = sesh.previewOffsetSec
						clip.fade_in_sec = sesh.previewFadeInSec
						clip.fade_out_sec = sesh.previewFadeOutSec
						dragSession.value = null
						return
					}

					const res = await socket.emitWithAck('get:clip:update', {
						id: clip.id,
						changes: {
							start_beat: sesh.previewStartBeat,
							end_beat: sesh.previewEndBeat,
							offset_seconds: sesh.previewOffsetSec,
							fade_in_sec: sesh.previewFadeInSec,
							fade_out_sec: sesh.previewFadeOutSec,
						},
					})

					if (res.success) {
						clip.start_beat = res.data['start_beat'] ?? sesh.previewStartBeat
						clip.end_beat = res.data['end_beat'] ?? sesh.previewEndBeat
						clip.offset_seconds = res.data['offset_seconds'] ?? sesh.previewOffsetSec
						clip.fade_in_sec = res.data['fade_in_sec'] ?? sesh.previewFadeInSec
						clip.fade_out_sec = res.data['fade_out_sec'] ?? sesh.previewFadeOutSec
					}

					dragSession.value = null
				}

				const stopMove = useEventListener(window, 'pointermove', onMove)
				const stopUp = useEventListener(window, 'pointerup', onUp)
			},
			{ passive: false },
		)
	}

	useEventListener(
		gainHandleEl,
		'pointerdown',
		(event) => {
			if (user.value?.banned_at) return
			if (event.button === 2) {
				return rip()
			}

			if (event.button !== 0) return

			if (altKeyPressed.value || controlKeyPressed.value || shiftKeyPressed.value) {
				event.preventDefault()
				event.stopPropagation()
				dragSession.value = null

				const clip = props.clip ? clips.get(props.clip.id) : undefined
				if (clip) {
					clip.gain = DEFAULT_GAIN

					if (!clip.id.startsWith('__temp__')) {
						socket.emitWithAck('get:clip:update', {
							id: clip.id,
							changes: { gain: DEFAULT_GAIN },
						})
					}
				}
				return
			}

			event.preventDefault()
			event.stopPropagation()

			dragSession.value = {
				side: 'gain',
				startX: event.clientX,
				origStartBeat: initialClipState.value.start_beat,
				origEndBeat: initialClipState.value.end_beat,
				origOffsetSec: initialClipState.value.offset_seconds,
				origGain: initialClipState.value.gain,
				previewStartBeat: initialClipState.value.start_beat,
				previewEndBeat: initialClipState.value.end_beat,
				previewOffsetSec: initialClipState.value.offset_seconds,
				previewGain: initialClipState.value.gain,
				startY: event.clientY,
				currentY: event.clientY,
				previewTrackId: props.clip!.track_id,
				verticalOffsetPx: 0,
				origFadeInSec: initialClipState.value.fade_in_sec,
				origFadeOutSec: initialClipState.value.fade_out_sec,
				previewFadeInSec: initialClipState.value.fade_in_sec,
				previewFadeOutSec: initialClipState.value.fade_out_sec,
			}

			const el = event.currentTarget as HTMLElement
			el.setPointerCapture(event.pointerId)

			const onMove = (e: PointerEvent) => {
				const sesh = dragSession.value
				if (!sesh || sesh.side !== 'gain') return
				e.preventDefault()

				// Calculate gain delta based on vertical movement
				const deltaY = sesh.startY - e.clientY
				// Sensitivity: e.g. 100px move = 1.0 gain change
				const gainSensitivity = 1 / 100
				let newGain = sesh.origGain + deltaY * gainSensitivity

				// Clamp to reasonable values (e.g. 0 to 4.0)
				newGain = Math.max(0, Math.min(newGain, 4))

				if (altKeyPressed.value || controlKeyPressed.value || shiftKeyPressed.value) {
					sesh.previewGain = DEFAULT_GAIN
				} else {
					sesh.previewGain = newGain
				}

				const clip = props.clip ? clips.get(props.clip.id) : undefined

				if (clip) {
					clip.gain = sesh.previewGain
				}
			}

			const onUp = async (e: PointerEvent) => {
				el.releasePointerCapture(e.pointerId)
				stopMove()
				stopUp()

				const sesh = dragSession.value
				if (!sesh || !props.clip || sesh.side !== 'gain') return

				const clip = clips.get(props.clip.id)
				if (!clip) return

				if (clip.id.startsWith('__temp__')) {
					clip.gain = sesh.previewGain
					dragSession.value = null
					return
				}

				const res = await socket.emitWithAck('get:clip:update', {
					id: clip.id,
					changes: {
						gain: sesh.previewGain,
					},
				})

				if (res.success) {
					clip.gain = res.data['gain'] ?? sesh.previewGain
				} else {
					clip.gain = sesh.origGain
				}

				dragSession.value = null
			}

			const stopMove = useEventListener(window, 'pointermove', onMove)
			const stopUp = useEventListener(window, 'pointerup', onUp)
		},
		{ passive: false },
	)

	useEventListener(gainHandleEl, 'dblclick', async (event) => {
		if (user.value?.banned_at || !props.clip) return
		event.preventDefault()
		event.stopPropagation()

		const clip = clips.get(props.clip.id)
		if (!clip) return

		if (clip.id.startsWith('__temp__')) {
			clip.gain = 1.0
			return
		}

		const res = await socket.emitWithAck('get:clip:update', {
			id: clip.id,
			changes: {
				gain: 1.0,
			},
		})

		if (res.success) {
			clip.gain = res.data['gain'] ?? 1.0
		}
	})

	const fadeHandles = [
		{ side: 'fade-in' as const, el: fadeInHandleEl },
		{ side: 'fade-out' as const, el: fadeOutHandleEl },
	]

	for (const { side, el: handleEl } of fadeHandles) {
		useEventListener(
			handleEl,
			'pointerdown',
			(event) => {
				if (user.value?.banned_at) return
				if (event.button !== 0) return
				event.preventDefault()
				event.stopPropagation()

				dragSession.value = {
					side,
					startX: event.clientX,
					origStartBeat: initialClipState.value.start_beat,
					origEndBeat: initialClipState.value.end_beat,
					origOffsetSec: initialClipState.value.offset_seconds,
					origGain: initialClipState.value.gain,
					previewStartBeat: initialClipState.value.start_beat,
					previewEndBeat: initialClipState.value.end_beat,
					previewOffsetSec: initialClipState.value.offset_seconds,
					previewGain: initialClipState.value.gain,
					startY: event.clientY,
					currentY: event.clientY,
					previewTrackId: props.clip!.track_id,
					verticalOffsetPx: 0,
					origFadeInSec: initialClipState.value.fade_in_sec,
					origFadeOutSec: initialClipState.value.fade_out_sec,
					previewFadeInSec: initialClipState.value.fade_in_sec,
					previewFadeOutSec: initialClipState.value.fade_out_sec,
				}

				const el = event.currentTarget as HTMLElement
				el.setPointerCapture(event.pointerId)

				const onMove = (e: PointerEvent) => {
					const sesh = dragSession.value
					if (!sesh || sesh.side !== side) return
					e.preventDefault()

					const dxPx = e.clientX - sesh.startX
					const deltaSec = beats_to_sec(px_to_beats(dxPx))

					let newFadeIn = sesh.origFadeInSec
					let newFadeOut = sesh.origFadeOutSec
					const clipDurationSec = beats_to_sec(sesh.origEndBeat - sesh.origStartBeat)

					if (side === 'fade-in') {
						newFadeIn = Math.max(0, newFadeIn + deltaSec)
						newFadeIn = Math.min(
							newFadeIn,
							Math.max(0, clipDurationSec - FADE_MARGIN_SEC),
						)

						if (newFadeIn + newFadeOut + FADE_MARGIN_SEC > clipDurationSec) {
							newFadeOut = Math.max(0, clipDurationSec - newFadeIn - FADE_MARGIN_SEC)
						}
					} else {
						// fade-out
						newFadeOut = Math.max(0, newFadeOut - deltaSec)
						newFadeOut = Math.min(
							newFadeOut,
							Math.max(0, clipDurationSec - FADE_MARGIN_SEC),
						)

						if (newFadeIn + newFadeOut + FADE_MARGIN_SEC > clipDurationSec) {
							newFadeIn = Math.max(0, clipDurationSec - newFadeOut - FADE_MARGIN_SEC)
						}
					}

					sesh.previewFadeInSec = newFadeIn
					sesh.previewFadeOutSec = newFadeOut
				}

				const onUp = async (e: PointerEvent) => {
					el.releasePointerCapture(e.pointerId)
					stopMove()
					stopUp()

					const sesh = dragSession.value
					if (!sesh || !props.clip || sesh.side !== side) return

					const clip = clips.get(props.clip.id)
					if (!clip) return

					if (clip.id.startsWith('__temp__')) {
						clip.fade_in_sec = sesh.previewFadeInSec
						clip.fade_out_sec = sesh.previewFadeOutSec
						dragSession.value = null
						return
					}

					const res = await socket.emitWithAck('get:clip:update', {
						id: clip.id,
						changes: {
							fade_in_sec: sesh.previewFadeInSec,
							fade_out_sec: sesh.previewFadeOutSec,
						},
					})

					if (res.success) {
						clip.fade_in_sec = res.data['fade_in_sec'] ?? sesh.previewFadeInSec
						clip.fade_out_sec = res.data['fade_out_sec'] ?? sesh.previewFadeOutSec
					} else {
						clip.fade_in_sec = sesh.origFadeInSec
						clip.fade_out_sec = sesh.origFadeOutSec
					}

					dragSession.value = null
				}

				const stopMove = useEventListener(window, 'pointermove', onMove)
				const stopUp = useEventListener(window, 'pointerup', onUp)
			},
			{ passive: false },
		)
	}

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
		transform: `scaleY(${displayState.value.gain})`,
	} satisfies CSSProperties
})

const waveformsDrawn = shallowRef<boolean>(false)
const isSelectedWaveformColor = '#f24b4b' as const

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

	try {
		ctx.scale(pr, pr)

		// Since we are stretching LODs, we want to disable smoothing to keep it crisp
		ctx.imageSmoothingEnabled = false

		const bitmap = getWaveform(props.audiofile, canvasWidth.value, props.audiofile.duration)

		if (bitmap) {
			ctx.clearRect(0, 0, canvasWidth.value, canvasHeight.value)
			ctx.drawImage(bitmap, 0, 0, canvasWidth.value, canvasHeight.value)

			ctx.globalCompositeOperation = 'source-in'

			const isCurrentPoolFile =
				withinAudioPool.value == true &&
				poolPreviewPlayingAudioId.value == props.audiofile.id &&
				poolPreviewPlayingAudioId.value

			const color = isSelected.value ? isSelectedWaveformColor : props.audiofile.color

			if (!isCurrentPoolFile) {
				// Mix with black (0.2 = 20% black)
				const mixed = interpolate([color, '#000000'])(0.2)
				const finalColor = formatHex(mixed) ?? props.audiofile.color
				ctx.fillStyle = finalColor
				ctx.fillRect(0, 0, canvasWidth.value, canvasHeight.value)
			} else {
				const progress = getPreviewProgress()

				const grad = ctx.createLinearGradient(0, 0, canvasWidth.value, 0)

				grad.addColorStop(0, color)
				grad.addColorStop(progress, color)
				grad.addColorStop(
					progress,
					formatHex(interpolate([color, '#000000'])(0.4)) ?? color,
				)
				grad.addColorStop(1, formatHex(interpolate([color, '#000000'])(0.4)) ?? color)

				ctx.fillStyle = grad
				ctx.fillRect(0, 0, canvasWidth.value, canvasHeight.value)
			}

			ctx.globalCompositeOperation = 'source-over'

			waveformsDrawn.value = true
		}
	} finally {
		ctx.restore()
	}
}

watchThrottled(
	[
		canvasHeight,
		canvasWidth,
		() => props.audiofile.waveforms,
		() => props.audiofile.color,
		pixelRatio,
		poolPreviewPlayingAudioId,
	],
	() => {
		if (poolPreviewPlayingAudioId.value != props.audiofile.id) {
			pauseWaveformUpdate()
		}
		drawWaveform()
	},
	{ immediate: false, throttle: 200 },
)

watch(isSelected, () => drawWaveform(), { immediate: false })

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

.outmostClipWrapper.selected {
	box-shadow: 0 0 0 1px #ff4444;
}

.outmostClipWrapper.selected .clipHeader {
	background-color: #ff4444 !important;
	color: white !important;
}

.outmostClipWrapper.selected .outerClipCanvasWrap {
	background-color: rgba(255, 25, 25, 0.2) !important;
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

.gainhandle {
	position: absolute;

	height: 1.6rem;
	width: 2.2rem;
	max-width: calc(
		2 *
			min(
				var(--relative-left, 50%) - min(1rem, 30%),
				100% - var(--relative-left, 50%) - min(1rem, 30%)
			)
	);
	min-width: 1rem;

	--_mod-distance: 0.3rem;
	--_bottom-pad: 1px;

	left: var(--relative-left, 50%);
	bottom: 0;
	transform: translateX(-50%);
	z-index: 10;
	cursor: ns-resize;
	opacity: 0;
	transition: opacity 150ms ease;

	background-color: transparent;

	/* border: 1px solid purple; */

	display: flex;
	align-items: flex-end;
	justify-content: center;

	clip-path: polygon(
		0 0,
		100% 0,
		100% calc(100% - var(--_bottom-pad)),
		0 calc(100% - var(--_bottom-pad))
	);
}

.gainhandle::after {
	content: '';
	display: block;

	width: 1rem;
	height: 1rem;

	border-radius: 50%;
	background-color: var(--text-color-primary);
	box-shadow: 0 0 4px rgba(0, 0, 0, 0.3);

	margin-bottom: calc(-1 * var(--_mod-distance));

	transition: transform 120ms ease;
}

.outmostClipWrapper:hover .gainhandle,
.outmostClipWrapper.is-dragging .gainhandle {
	opacity: 1;
}

.gainhandle:active::after {
	transform: scale(1.2);
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

.file-pool-button {
	grid-area: canvas;
	right: 0;
	top: 0;
	position: relative;
	z-index: 1;

	height: 2.1rem;
	width: 2.1rem;

	aspect-ratio: 1/1;

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
/* both flex properties since we may want to have top buttons in the future */
.trash-button {
	justify-self: flex-end;
	align-self: flex-end;
}
.play-button {
	justify-self: flex-start;
	align-self: flex-end;
}

.fade-triangle {
	position: absolute;
	top: 0;
	bottom: 0;
	pointer-events: none;
	z-index: 3;
}

.fade-in-triangle {
	left: 0;
	background: color-mix(in lch, var(--bg-color) 60%, transparent);
	clip-path: polygon(0 0, 100% 0, 0 100%);
}

.fade-out-triangle {
	right: 0;
	background: color-mix(in lch, var(--bg-color) 60%, transparent);
	clip-path: polygon(100% 0, 0 0, 100% 100%);
}

.fade-handle {
	position: absolute;
	top: 0;
	width: min(1rem, 30%);
	height: 1.6rem;
	z-index: 6;
	cursor: ew-resize;
}

.fade-handle::after {
	content: '';
	background-color: var(--text-color-primary);
	box-shadow: 0 0 4px rgba(0, 0, 0, 0.3);
	border-bottom-right-radius: 1220%;

	position: absolute;
	top: 0;
	left: 0;
	height: 0.8rem;
	width: 0.8rem;
}

.fade-out-handle::after {
	border-bottom-right-radius: 0;
	border-bottom-left-radius: 1220%;
}

.fade-out-handle {
	left: unset;
}
</style>
