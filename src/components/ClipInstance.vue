<template>
	<div
		v-memo="[
			wrapperStyles,
			waveformsDrawn,
			canvasStyles,
			props.audiofile.file_name,
			isHovered,
			isSelected,
			isDragging,
			poolPreviewPlayingAudioId,
			gainHandleStyle,
			fadeInWidthPx,
			fadeOutWidthPx,
			displayState.is_muted,
		]"
		ref="clipWrapper"
		class="outmostClipWrapper clip"
		:class="{
			selected: isSelected,
			'is-dragging': isDragging,
			muted: displayState.is_muted,
		}"
		:style="wrapperStyles"
		@contextmenu.prevent="deleteClip"
	>
		<div class="clipHeader" :style="{ color: activeColors.textColor }">
			<p class="smaller title no-select">
				@{{ userClipDisplayComp || '' }} • {{ props.audiofile.file_name }} - 𝆕
				{{ props.audiofile.creator_display_name }}
			</p>
		</div>

		<div
			ref="canvasWrap"
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

		<!-- GAIN DISPLAY -->
		<div
			v-if="!withinAudioPool && displayState.gain !== DEFAULT_GAIN && waveformsDrawn"
			v-show="gainDisplayFits"
			ref="gainDisplay"
			class="txt mono small gainDisplay no-select"
			:style="gainHandleStyle"
			:class="{ selected: isSelected }"
		>
			{{ gainDisplayText }}
		</div>

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
	clips,
	audiofiles,
	dragFromPoolState,
	pixelRatio,
	rightMouseButtonPressedOnTimeline,
	user,
	selectedClipIds,
	trackControlsWidth,
	poolPreviewPlayingAudioId,
	dragSessionMulti,
	tracks,
	type DragSession,
	trackIdsInOrderByIndex,
	pxTrackHeight,
} from '@/state'
import { altKeyPressed, controlKeyPressed, shiftKeyPressed } from '@/utils/globalHotKeys'
import type { ClipClient, ClipUpdate } from '~/schema'
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
	gain_to_db,
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
import { deleteClipLocally } from '@/socket/eventHandlers/clip_delete'
import { updateClips } from '@/socket/eventHandlers/clip_update'
import { nanoid } from 'nanoid'

const MIN_GAIN = 0 as const
const MAX_GAIN = 3 as const

const getCalculatedGain = (opts: {
	initialGain: number
	deltaGain: number
	shouldReset: boolean
}) => {
	const { initialGain, deltaGain, shouldReset } = opts
	if (shouldReset) return DEFAULT_GAIN
	return Math.max(MIN_GAIN, Math.min(MAX_GAIN, initialGain + deltaGain))
}

const getCalculatedFade = (
	initialFade: number,
	deltaFade: number,
	otherFade: number,
	durationSec: number,
) => {
	const maxFade = Math.max(0, durationSec - otherFade - FADE_MARGIN_SEC)
	return Math.max(0, Math.min(maxFade, initialFade + deltaFade))
}

function getSelectedClipsSnapshot() {
	const result: ClipClient[] = []
	for (const id of selectedClipIds) {
		const c = clips.get(id)
		if (c) result.push({ ...c })
	}
	return result
}

function calculateSquashedFades(
	initialIn: number,
	initialOut: number,
	newDurationSec: number,
	prioritySide: 'left' | 'right' | 'both',
) {
	let fadeIn = initialIn
	let fadeOut = initialOut
	const maxTotal = Math.max(0, newDurationSec - FADE_MARGIN_SEC)
	if (fadeIn + fadeOut > maxTotal) {
		if (prioritySide === 'left') {
			fadeOut = Math.max(0, Math.min(fadeOut, maxTotal - fadeIn))
			fadeIn = Math.max(0, Math.min(fadeIn, maxTotal - fadeOut))
		} else if (prioritySide === 'right') {
			fadeIn = Math.max(0, Math.min(fadeIn, maxTotal - fadeOut))
			fadeOut = Math.max(0, Math.min(fadeOut, maxTotal - fadeIn))
		} else {
			const ratio = maxTotal / (fadeIn + fadeOut)
			fadeIn *= ratio
			fadeOut *= ratio
		}
	}
	return { fadeInSec: fadeIn, fadeOutSec: fadeOut }
}

const MIN_CLIP_LENGTH_BEATS = 0.3 as const

const gainDisplayText = computed(() => {
	const db = gain_to_db(displayState.value.gain)
	if (db === -Infinity) return '-∞'
	return db.toFixed(2)
})

const { userLog } = useConsole()

const wrapperEl = useTemplateRef('clipWrapper')
const leftHandleEl = useTemplateRef('leftHandle')
const rightHandleEl = useTemplateRef('rightHandle')
const gainHandleEl = useTemplateRef('gainHandle')
const fadeInHandleEl = useTemplateRef('fadeInHandle')
const fadeOutHandleEl = useTemplateRef('fadeOutHandle')
const gainDisplayEl = useTemplateRef('gainDisplay')

const canvasEl = useTemplateRef('canvas')
const canvasWrapEl = useTemplateRef('canvasWrap')
const { width: canvasWidth } = useElementBounding(canvasEl)
const { height: canvasWrapHeight } = useElementBounding(canvasWrapEl)
const { width: gainDisplayWidth } = useElementBounding(gainDisplayEl)
const isHovered = useElementHover(wrapperEl)

const lastKnownGainDisplayWidth = ref(45)
watch(gainDisplayWidth, (val) => {
	if (val > 0) lastKnownGainDisplayWidth.value = val
})

type ClipProps = {
	audiofile: AudioFile
	clip?: ClipClient
	customWidthPx?: number
	deletable?: boolean
	scrollX?: number
	timelineWindowWidth?: number
	parentTrackEl: HTMLElement | null
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

const activeColors = computed(() => {
	const isMuted = displayState.value.is_muted
	const selected = isSelected.value

	const baseColor = props.audiofile.color

	const SELECTED_WAVEFORM = '#f24b4b'
	const SELECTED_HEADER_BG = '#ff4444'
	const SELECTED_CANVAS_BG = 'rgba(255, 25, 25, 0.2)'
	const SELECTED_TEXT = '#ffffff'

	const MUTED_WAVEFORM = 'hsl(0 0% 28%)'
	const MUTED_HEADER_BG = 'hsl(0 0% 24%)'
	const MUTED_CANVAS_BG = `color-mix(in lch, ${MUTED_WAVEFORM} 13%, transparent)`
	const MUTED_TEXT = 'hsl(0 0% 46%)'

	let headerBg = baseColor
	let waveform = baseColor

	let canvasBg = `color-mix(in lch, ${baseColor} 13%, transparent)`

	let textColor = '#ffffff'

	if (!(selected && !isMuted)) {
		const textLuminanceBase = parse(headerBg)
		const L = textLuminanceBase ? wcagLuminance(textLuminanceBase) : 1
		textColor = L > 0.5 ? '#000000' : '#ffffff'
	}

	if (selected) {
		headerBg = SELECTED_HEADER_BG
		waveform = SELECTED_WAVEFORM
		canvasBg = SELECTED_CANVAS_BG
		textColor = SELECTED_TEXT
	}

	if (isMuted) {
		headerBg = MUTED_HEADER_BG
		waveform = MUTED_WAVEFORM
		canvasBg = MUTED_CANVAS_BG
		textColor = MUTED_TEXT
	}

	let gainColor = `color-mix(in lch, ${headerBg}, var(--text-color-primary) 30%)`

	if (selected && !isMuted) {
		gainColor = `color-mix(in lch, #ff4444, var(--text-color-primary) 30%)`
	}

	return {
		headerBg,
		waveform,
		canvasBg,
		textColor,
		gainColor,
	}
})

const outerClipCanvasStyles = computed((): CSSProperties => {
	const base: CSSProperties = {
		backgroundColor: activeColors.value.canvasBg,
	}

	// if (withinAudioPool.value) {
	base.borderBottomLeftRadius = 'inherit'
	base.borderBottomRightRadius = 'inherit'
	// }

	return base
})

async function deleteClip() {
	if (!props.clip) return

	const res = await socket.emitWithAck('get:clip:delete', [props.clip.id])

	if (res.success) {
		for (const id of res.data) {
			deleteClipLocally(id)
		}
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

const unifiedClipState = computed(() => {
	if (!props.audiofile) throw new Error(`No audio file prop provided`)
	if (props.clip)
		return {
			start_beat: props.clip.start_beat,
			end_beat: props.clip.end_beat,
			offset_seconds: props.clip.offset_seconds,
			gain: props.clip.gain,
			fade_in_sec: props.clip.fade_in_sec,
			fade_out_sec: props.clip.fade_out_sec,
			is_muted: props.clip.is_muted,
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
		is_muted: false,
	}
})

// switches to drag preview values when within selection or currently being edited through dragsessionmulti
const displayState = computed(
	(): {
		start_beat: ClipClient['start_beat']
		end_beat: ClipClient['end_beat']
		offset_seconds: ClipClient['offset_seconds']
		gain: ClipClient['gain']
		fade_in_sec: ClipClient['fade_in_sec']
		fade_out_sec: ClipClient['fade_out_sec']
		is_muted: ClipClient['is_muted']
	} => {
		if (!props.clip) return unifiedClipState.value
		if (!props.clip.id) return unifiedClipState.value

		if (!dragSessionMulti.value) return unifiedClipState.value

		if (
			selectedClipIds.has(props.clip.id) ||
			dragSessionMulti.value.source_clip.id === props.clip.id
		) {
			if (dragSessionMulti.value.mode === 'move') {
				return unifiedClipState.value
			}

			if (dragSessionMulti.value.mode === 'left-resize') {
				// updated in real-time in onMove for audio feedback
				return unifiedClipState.value
			}

			if (dragSessionMulti.value.mode === 'right-resize') {
				// updated in real-time in onMove for audio feedback
				return unifiedClipState.value
			}

			if (dragSessionMulti.value.mode === 'gain') {
				// gain is updated in real-time in onMove for audio feedback
				// just return the unified state which includes the current gain
				return unifiedClipState.value
			}

			if (dragSessionMulti.value.mode === 'fade-in') {
				// updated in real-time in onMove for audio feedback
				return unifiedClipState.value
			}

			if (dragSessionMulti.value.mode === 'fade-out') {
				// updated in real-time in onMove for audio feedback
				return unifiedClipState.value
			}

			// apply the deltas from the drag state
			return unifiedClipState.value
		}

		return unifiedClipState.value // fallback
	},
)

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

const isFadeDragging = computed(() => {
	if (!dragSessionMulti.value) return false

	if (dragSessionMulti.value.mode !== 'fade-in' && dragSessionMulti.value.mode !== 'fade-out') {
		return false
	}

	if (!props.clip) return false

	return selectedClipIds.has(props.clip.id)
})

const isDragging = computed(() => {
	if (!dragSessionMulti.value) return false
	if (!props.clip) return false

	// Returns true if the clip is either the one explicitly grabbed, or part of the tracked selection
	return (
		dragSessionMulti.value.source_clip.id === props.clip.id ||
		selectedClipIds.has(props.clip.id)
	)
})

const wrapperStyles = computed((): CSSProperties => {
	const base: CSSProperties = {
		width: `${finalWidthPx.value}px`,
		'--_color': activeColors.value.headerBg,
		left: `${beats_to_px(displayState.value.start_beat)}px`,
	}

	if (!props.clip) return base

	if (
		dragSessionMulti.value &&
		(selectedClipIds.has(props.clip.id) ||
			dragSessionMulti.value.source_clip.id === props.clip.id)
	) {
		if (dragSessionMulti.value.mode === 'move') {
			const offsetPx = dragSessionMulti.value.delta_tracks * pxTrackHeight
			base.top = `${offsetPx}px`
		}
	}

	return base
})

const visibleRange = computed(() => {
	if (props.scrollX === undefined || props.timelineWindowWidth === undefined) {
		return null
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
		return { left: visibleLeft, right: visibleRight, clipLeft }
	}

	return null
})

const gainDisplayFits = computed(() => {
	const range = visibleRange.value
	if (!range) return false
	const availableWidth = range.right - range.left
	const requiredWidth = lastKnownGainDisplayWidth.value || 45
	return availableWidth >= requiredWidth + 6 // padding
})

const gainHandleStyle = computed((): CSSProperties | undefined => {
	const range = visibleRange.value
	if (!range) return undefined

	const centerAbs = (range.left + range.right) / 2
	const relativeLeft = centerAbs - range.clipLeft
	return {
		left: `${relativeLeft}px`,
		'--relative-left': `${relativeLeft}px`,
		color: activeColors.value.gainColor,
	}
})

type DragMode = 'left' | 'right' | 'move' | 'gain' | 'fade-in' | 'fade-out'

const FADE_MARGIN_SEC = 0.1

async function commitPendingUpdates(dragSession: DragSession) {
	const sesh = dragSession
	if (!sesh) return

	const res = await socket
		.emitWithAck(
			'get:clip:update',
			sesh.initial_states.flatMap((stored) => {
				const clip = clips.get(stored.id)
				if (!clip) return []

				let changes: ClipUpdate = {}

				if (sesh.mode === 'left-resize') {
					changes = {
						start_beat: clip.start_beat,
						offset_seconds: clip.offset_seconds,
					}
				}

				if (sesh.mode === 'right-resize') {
					changes = {
						end_beat: clip.end_beat,
					}
				}

				if (sesh.mode === 'fade-in') {
					changes = {
						fade_in_sec: clip.fade_in_sec,
					}
				}

				if (sesh.mode === 'fade-out') {
					changes = { fade_out_sec: clip.fade_out_sec }
				}

				if (sesh.mode === 'gain') {
					changes = {
						gain: sesh.reset_to_default_gain ? DEFAULT_GAIN : clip.gain,
					}
				}

				if (sesh.mode === 'move') {
					const oldTrackId = clip.track_id
					const oldTrackIndex = trackIdsInOrderByIndex.value.findIndex(
						(t) => t === oldTrackId,
					)

					if (oldTrackIndex === -1) return []

					const newTrackId =
						trackIdsInOrderByIndex.value[oldTrackIndex + sesh.delta_tracks]
					if (!newTrackId) return []

					changes = {
						start_beat: clip.start_beat,
						end_beat: clip.end_beat,
						fade_in_sec: clip.fade_in_sec,
						fade_out_sec: clip.fade_out_sec,
						track_id: newTrackId,
					}
				}

				return [
					{
						id: clip.id,
						changes,
					},
				] satisfies { id: ClipClient['id']; changes: ClipUpdate }[]
			}),
		)
		.catch((err) => {
			// todo: perhaps pass error?
			return {
				success: false as const,
				error: {
					message:
						'An unexpected error occurred while editing clips. Please refresh and try again',
				},
			}
		})

	if (res && res.success) {
		updateClips(res.data)
	} else {
		userLog(
			'SYSTEM',
			res ? res.error.message : "Couldn't commit clip edits. Refresh and try again.",
		)
	}

	dragSessionMulti.value = null
}

// commit shift-drag-duplicated clips as new clip creations
async function commitDuplicateClips(sesh: DragSession & { mode: 'move' }) {
	const tempClips = sesh.initial_states
		.map((stored) => clips.get(stored.id))
		.filter((c): c is ClipClient => c !== undefined)

	if (tempClips.length === 0) {
		dragSessionMulti.value = null
		return
	}

	const tempIds = tempClips.map((c) => c.id)

	const reqBody = tempClips.map((clip) => {
		const oldTrackId = clip.track_id
		const oldTrackIndex = trackIdsInOrderByIndex.value.findIndex((t) => t === oldTrackId)
		const newTrackId =
			oldTrackIndex !== -1
				? (trackIdsInOrderByIndex.value[oldTrackIndex + sesh.delta_tracks] ?? oldTrackId)
				: oldTrackId

		return {
			start_beat: clip.start_beat,
			end_beat: clip.end_beat,
			audio_file_id: clip.audio_file_id,
			track_id: newTrackId,
			offset_seconds: clip.offset_seconds,
			gain: clip.gain,
			fade_in_sec: clip.fade_in_sec,
			fade_out_sec: clip.fade_out_sec,
			is_muted: clip.is_muted,
		}
	})

	try {
		const res = await socket.emitWithAck('get:clip:create', reqBody)
		if (res.success) {
			// swap temp ids for real server ids
			for (const id of tempIds) {
				clips.delete(id)
				selectedClipIds.delete(id)
			}
			for (const clip of res.data) {
				clips.set(clip.id, clip)
				selectedClipIds.add(clip.id)
			}
		} else {
			throw new Error(res.error.message)
		}
	} catch (e) {
		userLog('SYSTEM', `Duplicate failed: ${e instanceof Error ? e.message : String(e)}`, {
			textColor: 'red',
		})
		// clean up temp clones
		for (const id of tempIds) {
			clips.delete(id)
			selectedClipIds.delete(id)
		}
	}

	dragSessionMulti.value = null
}

// all audiopool exclusive listeners
onMounted(() => {
	if (!withinAudioPool.value) return
	if (!wrapperEl.value) return

	useEventListener(wrapperEl, 'pointerdown', (event) => {
		if (user.value?.banned_at) return
		if (event.button === 1) return // wheel-click ignored for panning of pool.

		if (!(wrapperEl.value instanceof HTMLElement)) return

		event.preventDefault()

		const rectBounds = wrapperEl.value.getBoundingClientRect()

		dragFromPoolState.value = {
			audioFileId: props.audiofile.id,
			offsetPx: event.clientX - rectBounds.left,
			clientX: event.clientX,
			clientY: event.clientY,
		}
	})
})

onMounted(() => {
	if (withinAudioPool.value) return // todo: consider throwing error?
	if (!wrapperEl.value) return // todo: consider throwing error?

	useEventListener(wrapperEl, 'pointerenter', () => {
		if (rightMouseButtonPressedOnTimeline.value) {
			deleteClip()
		}
	})

	// move clip
	useEventListener(
		wrapperEl,
		'pointerdown',
		(event) => {
			// child elements like handles etc prevent default and stop
			// propagation such that events that reach this listener
			// are essentially guaranteed to be simple move click and drags.
			if (event.defaultPrevented) return

			if (event.button === 2) {
				// right click
				return deleteClip()
			}

			if (event.button !== 0) return // only left click
			if (controlKeyPressed.value) return // Allow bubble for selection

			event.preventDefault()
			event.stopPropagation()

			const parentTrack = props.parentTrackEl
			if (!parentTrack) return

			const parentTrackId = parentTrack.dataset.trackId
			if (!parentTrackId) return

			const sourceTrack = tracks.get(parentTrackId)
			if (!sourceTrack) return // should always be available in playlist clips

			if (!props.clip) return

			const currentUser = user.value
			if (!currentUser) return

			let clipsToTrack = getSelectedClipsSnapshot()

			const pc = props.clip

			if (pc.id && !selectedClipIds.has(pc.id)) {
				selectedClipIds.clear()
				clipsToTrack = [{ ...pc }]
			}

			const isDuplicate = shiftKeyPressed.value

			// shift-drag - create temp clones, leave originals untouched
			if (isDuplicate) {
				const clones: ClipClient[] = clipsToTrack.map((clip) => ({
					...clip,
					id: `__temp__${nanoid()}`,
					created_at: new Date().toISOString(),
					creator_user_id: currentUser.id,
					creator_display_name: currentUser.display_name,
				}))

				selectedClipIds.clear()
				for (const clone of clones) {
					clips.set(clone.id, clone)
					selectedClipIds.add(clone.id)
				}

				clipsToTrack = clones.map((c) => ({ ...c }))
			}

			const firstClone = clipsToTrack[0]
			if (!firstClone) return

			dragSessionMulti.value = {
				mode: 'move',
				source_clip: isDuplicate ? firstClone : props.clip,
				source_track: sourceTrack,
				delta_beats: 0,
				delta_tracks: 0,
				mouse_start_x: event.clientX,
				source_track_el: parentTrack,
				initial_states: clipsToTrack,
				is_duplicate: isDuplicate,
			}

			let el: HTMLElement | undefined

			if (event.currentTarget instanceof HTMLElement) {
				el = event.currentTarget
				el.setPointerCapture(event.pointerId)
			}

			function onMove(e: PointerEvent) {
				if (!dragSessionMulti.value) return console.warn('dragsession missing onMove')

				e.preventDefault()

				if (dragSessionMulti.value.mode !== 'move')
					return console.warn('dragsession mode changed') // todo: prolly requires listener cleanup? idk maybe track globally omg aaaa scope exploding haha

				const sourceTrack = dragSessionMulti.value.source_track

				// horizontal
				const dxPx = e.clientX - dragSessionMulti.value.mouse_start_x
				const rawDeltaBeats = altKeyPressed.value
					? px_to_beats(dxPx)
					: quantize_beats(px_to_beats(dxPx))

				let minAllowedDeltaBeats = -Infinity
				let maxAllowedDeltaBeats = Infinity

				dragSessionMulti.value.initial_states.forEach((stored) => {
					const allowedLeft = -stored.start_beat
					if (allowedLeft > minAllowedDeltaBeats) minAllowedDeltaBeats = allowedLeft

					const allowedRight = TOTAL_BEATS - MIN_CLIP_LENGTH_BEATS - stored.start_beat
					if (allowedRight < maxAllowedDeltaBeats) maxAllowedDeltaBeats = allowedRight
				})

				const clampedDeltaBeats = Math.max(
					minAllowedDeltaBeats,
					Math.min(maxAllowedDeltaBeats, rawDeltaBeats),
				)
				dragSessionMulti.value.delta_beats = clampedDeltaBeats

				// vertical
				const els = document.elementsFromPoint(e.clientX, e.clientY)
				const targetTrackEl = els.find(
					(el) => el instanceof HTMLElement && el.dataset.trackId,
				) as HTMLElement | undefined

				if (!targetTrackEl || !dragSessionMulti.value.source_track_el)
					return console.warn('dragsession missing track elements or datasets')

				const indexOriginTrack = trackIdsInOrderByIndex.value.findIndex(
					(t) => t === sourceTrack.id,
				)

				const indexCurrentTrack = trackIdsInOrderByIndex.value.findIndex(
					(t) => t === targetTrackEl.dataset.trackId,
				)

				if (indexOriginTrack === -1 || indexCurrentTrack === -1)
					return console.warn('dragsession track indexing issue, investigate further...')

				const rawDeltaTracks = indexCurrentTrack - indexOriginTrack

				let minAllowedDeltaTracks = -Infinity
				let maxAllowedDeltaTracks = Infinity

				dragSessionMulti.value.initial_states.forEach((stored) => {
					const trackIndex = trackIdsInOrderByIndex.value.findIndex(
						(t) => t === stored.track_id,
					)
					if (trackIndex === -1) return

					const allowedUp = -trackIndex
					if (allowedUp > minAllowedDeltaTracks) minAllowedDeltaTracks = allowedUp

					const allowedDown = trackIdsInOrderByIndex.value.length - 1 - trackIndex
					if (allowedDown < maxAllowedDeltaTracks) maxAllowedDeltaTracks = allowedDown
				})

				const clampedDeltaTracks = Math.max(
					minAllowedDeltaTracks,
					Math.min(maxAllowedDeltaTracks, rawDeltaTracks),
				)

				dragSessionMulti.value.delta_tracks = clampedDeltaTracks

				dragSessionMulti.value.initial_states.forEach((stored) => {
					const clip = clips.get(stored.id)
					if (!clip) return

					clip.start_beat = stored.start_beat + clampedDeltaBeats
					clip.end_beat = Math.min(TOTAL_BEATS, stored.end_beat + clampedDeltaBeats)

					const newDurationSec = beats_to_sec(clip.end_beat - clip.start_beat)
					const { fadeInSec, fadeOutSec } = calculateSquashedFades(
						stored.fade_in_sec,
						stored.fade_out_sec,
						newDurationSec,
						'right',
					)
					clip.fade_in_sec = fadeInSec
					clip.fade_out_sec = fadeOutSec
				})
			}

			async function onUp(e: PointerEvent) {
				if (el) el.releasePointerCapture(e.pointerId)

				stopMove()
				stopUp()

				if (!dragSessionMulti.value) return console.warn('missing dragsession in onUp')

				if (dragSessionMulti.value.mode === 'move' && dragSessionMulti.value.is_duplicate) {
					await commitDuplicateClips(dragSessionMulti.value)
				} else {
					await commitPendingUpdates(dragSessionMulti.value)
				}
			}

			const stopMove = useEventListener(window, 'pointermove', onMove)
			const stopUp = useEventListener(window, 'pointerup', onUp)
		},
		{ passive: false },
	)

	const resizeHandles = [
		{ side: 'left' as const, el: leftHandleEl },
		{ side: 'right' as const, el: rightHandleEl },
	]

	// resize
	for (const { side, el: handleEl } of resizeHandles) {
		useEventListener(
			handleEl,
			'pointerdown',
			(event) => {
				if (event.button === 2) {
					return deleteClip() // right click
				}

				if (event.button !== 0) return // only left click

				event.preventDefault()
				event.stopPropagation()

				if (!props.clip) return

				// todo: do we return on control key pressed for selection bubble?

				let clipstoTrack = getSelectedClipsSnapshot()

				const pc = props.clip

				if (pc.id && !selectedClipIds.has(pc.id)) {
					selectedClipIds.clear()
					clipstoTrack = [{ ...pc }]
				}

				dragSessionMulti.value =
					side === 'left'
						? {
								mode: 'left-resize',
								initial_start_beat: props.clip.start_beat,
								delta_beats_start: 0,
								mouse_start_x: event.clientX,
								source_clip: props.clip,
								initial_states: clipstoTrack,
							}
						: {
								mode: 'right-resize',
								initial_end_beat: props.clip.end_beat,
								delta_beats_end: 0,
								mouse_start_x: event.clientX,
								source_clip: props.clip,
								initial_states: clipstoTrack,
							}

				let el: HTMLElement | undefined

				if (event.currentTarget instanceof HTMLElement) {
					el = event.currentTarget
					el.setPointerCapture(event.pointerId)
				}

				function onMove(e: PointerEvent) {
					const sesh = dragSessionMulti.value
					if (!sesh || (sesh.mode !== 'left-resize' && sesh.mode !== 'right-resize'))
						return

					e.preventDefault()

					if (sesh.mode === 'left-resize') {
						const dxPx = e.clientX - sesh.mouse_start_x
						const deltaBeats = altKeyPressed.value
							? px_to_beats(dxPx)
							: quantize_beats(px_to_beats(dxPx))

						sesh.delta_beats_start = deltaBeats

						sesh.initial_states.forEach((stored) => {
							const clip = clips.get(stored.id)
							if (!clip) return

							let newStart = stored.start_beat + deltaBeats
							newStart = Math.min(newStart, stored.end_beat - MIN_CLIP_LENGTH_BEATS)

							let newOffsetSec =
								stored.offset_seconds + beats_to_sec(newStart - stored.start_beat)
							if (newOffsetSec < 0) {
								newOffsetSec = 0
								newStart = stored.start_beat - sec_to_beats(stored.offset_seconds)
							}

							if (newStart < 0) {
								newStart = 0
								newOffsetSec =
									stored.offset_seconds +
									beats_to_sec(newStart - stored.start_beat)
							}

							clip.start_beat = newStart
							clip.offset_seconds = newOffsetSec

							const newDurationSec = beats_to_sec(clip.end_beat - clip.start_beat)
							const { fadeInSec, fadeOutSec } = calculateSquashedFades(
								stored.fade_in_sec,
								stored.fade_out_sec,
								newDurationSec,
								'left',
							)
							clip.fade_in_sec = fadeInSec
							clip.fade_out_sec = fadeOutSec
						})
						return
					}

					if (sesh.mode === 'right-resize') {
						const dxPx = e.clientX - sesh.mouse_start_x
						const deltaBeats = altKeyPressed.value
							? px_to_beats(dxPx)
							: quantize_beats(px_to_beats(dxPx))

						sesh.delta_beats_end = deltaBeats

						sesh.initial_states.forEach((stored) => {
							const clip = clips.get(stored.id)
							if (!clip) return

							let newEnd = stored.end_beat + deltaBeats
							newEnd = Math.max(newEnd, stored.start_beat + MIN_CLIP_LENGTH_BEATS)
							newEnd = Math.min(newEnd, TOTAL_BEATS)

							const audioFile = audiofiles.get(clip.audio_file_id)
							if (audioFile) {
								const fileMaxEnd =
									stored.start_beat +
									sec_to_beats(audioFile.duration - stored.offset_seconds)
								newEnd = Math.min(newEnd, fileMaxEnd)
							}

							clip.end_beat = newEnd

							const newDurationSec = beats_to_sec(clip.end_beat - clip.start_beat)
							const { fadeInSec, fadeOutSec } = calculateSquashedFades(
								stored.fade_in_sec,
								stored.fade_out_sec,
								newDurationSec,
								'right',
							)
							clip.fade_in_sec = fadeInSec
							clip.fade_out_sec = fadeOutSec
						})
						return
					}
				}

				async function onUp(e: PointerEvent) {
					if (el) el.releasePointerCapture(e.pointerId)

					stopMove()
					stopUp()

					if (!dragSessionMulti.value) return console.warn('missing dragsession in onUp')

					await commitPendingUpdates(dragSessionMulti.value)
				}

				const stopMove = useEventListener(window, 'pointermove', onMove)
				const stopUp = useEventListener(window, 'pointerup', onUp)
			},
			{ passive: false },
		)
	}

	const fadeHandles = [
		{ side: 'fade-in' as const, el: fadeInHandleEl },
		{ side: 'fade-out' as const, el: fadeOutHandleEl },
	]

	for (const { side, el: handleEl } of fadeHandles) {
		useEventListener(
			handleEl,
			'pointerdown',
			(event) => {
				if (event.button === 2) {
					return deleteClip() // right click
				}

				if (event.button !== 0) return // only left click

				event.preventDefault()
				event.stopPropagation()

				if (!props.clip) return

				let clipstoTrack = getSelectedClipsSnapshot()

				const pc = props.clip

				if (pc.id && !selectedClipIds.has(pc.id)) {
					selectedClipIds.clear()
					clipstoTrack = [{ ...pc }]
				}

				dragSessionMulti.value = {
					mode: side,
					mouse_start_x: event.clientX,
					initial_fade_sec:
						side === 'fade-in' ? props.clip.fade_in_sec : props.clip.fade_out_sec,
					delta_fade_sec: 0,
					source_clip: props.clip,
					initial_states: clipstoTrack,
				}

				let el: HTMLElement | undefined

				if (event.currentTarget instanceof HTMLElement) {
					el = event.currentTarget
					el.setPointerCapture(event.pointerId)
				}

				function onMove(e: PointerEvent) {
					const sesh = dragSessionMulti.value
					if (!sesh || (sesh.mode !== 'fade-in' && sesh.mode !== 'fade-out')) return

					e.preventDefault()

					const dxPx = e.clientX - sesh.mouse_start_x
					const deltaSec = beats_to_sec(px_to_beats(dxPx))

					sesh.delta_fade_sec = deltaSec

					sesh.initial_states.forEach((stored) => {
						const clip = clips.get(stored.id)
						if (!clip) return

						const durationSec = beats_to_sec(clip.end_beat - clip.start_beat)

						if (sesh.mode === 'fade-in') {
							clip.fade_in_sec = getCalculatedFade(
								stored.fade_in_sec,
								deltaSec,
								clip.fade_out_sec,
								durationSec,
							)
						} else if (sesh.mode === 'fade-out') {
							clip.fade_out_sec = getCalculatedFade(
								stored.fade_out_sec,
								-deltaSec,
								clip.fade_in_sec,
								durationSec,
							)
						} else {
							console.warn('dragsession mode changed')
						}
					})
				}

				async function onUp(e: PointerEvent) {
					if (el) el.releasePointerCapture(e.pointerId)

					stopMove()
					stopUp()

					if (!dragSessionMulti.value) return console.warn('missing dragsession in onUp')

					await commitPendingUpdates(dragSessionMulti.value)
				}

				const stopMove = useEventListener(window, 'pointermove', onMove)
				const stopUp = useEventListener(window, 'pointerup', onUp)
			},
			{ passive: false },
		)
	}

	// gain
	useEventListener(
		gainHandleEl,
		'pointerdown',
		(event) => {
			if (event.button === 2) {
				return deleteClip() // right click
			}

			if (event.button !== 0) return // left click only

			event.preventDefault()
			event.stopPropagation()

			if (!props.clip) return

			let clipstoTrack = getSelectedClipsSnapshot()

			const pc = props.clip

			if (pc.id && !selectedClipIds.has(pc.id)) {
				selectedClipIds.clear()
				clipstoTrack = [{ ...pc }]
			}

			dragSessionMulti.value = {
				mode: 'gain',
				initial_gain: props.clip.gain,
				mouse_start_x: event.clientX,
				delta_gain: 0,
				source_clip: props.clip,
				mouse_start_y: event.clientY,
				reset_to_default_gain:
					altKeyPressed.value || controlKeyPressed.value || shiftKeyPressed.value,
				initial_states: clipstoTrack,
			}

			let el: HTMLElement | undefined

			if (event.currentTarget instanceof HTMLElement) {
				el = event.currentTarget
				el.setPointerCapture(event.pointerId)
			}

			function onMove(e: PointerEvent) {
				if (!dragSessionMulti.value) return console.warn('dragsession missing onMove')

				e.preventDefault()

				if (dragSessionMulti.value.mode !== 'gain')
					return console.warn('dragsession mode changed')

				const GAIN_SENSITIVITY = 0.005 as const // 1 / 200

				const dyPx = e.clientY - dragSessionMulti.value.mouse_start_y
				const deltaGain = dyPx * -GAIN_SENSITIVITY

				dragSessionMulti.value.delta_gain = deltaGain

				const shouldReset =
					altKeyPressed.value || controlKeyPressed.value || shiftKeyPressed.value
				dragSessionMulti.value.reset_to_default_gain = shouldReset

				dragSessionMulti.value.initial_states.forEach((stored) => {
					const clip = clips.get(stored.id)
					if (!clip) return

					clip.gain = getCalculatedGain({
						initialGain: stored.gain,
						deltaGain,
						shouldReset,
					})
				})
			}

			async function onUp(e: PointerEvent) {
				if (el) el.releasePointerCapture(e.pointerId)

				stopMove()
				stopUp()

				if (!dragSessionMulti.value) return console.warn('missing dragsession in onUp')

				await commitPendingUpdates(dragSessionMulti.value)
			}

			const stopMove = useEventListener(window, 'pointermove', onMove)
			const stopUp = useEventListener(window, 'pointerup', onUp)

			if (dragSessionMulti.value.reset_to_default_gain) {
				dragSessionMulti.value.initial_states.forEach((stored) => {
					const clip = clips.get(stored.id)
					if (!clip) return

					clip.gain = getCalculatedGain({
						initialGain: stored.gain,
						deltaGain: DEFAULT_GAIN, // dummy
						shouldReset: true,
					})
				})

				onUp(event)
			}
		},
		{ passive: false },
	)
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

async function drawWaveform() {
	if (!canvasEl.value || !props.audiofile) return

	const pr = pixelRatio.value || 1

	if (
		canvasEl.value.width !== canvasWidth.value * pr ||
		canvasEl.value.height !== canvasWrapHeight.value * pr
	) {
		canvasEl.value.width = canvasWidth.value * pr
		canvasEl.value.height = canvasWrapHeight.value * pr
	}

	const { width, height } = canvasEl.value
	if (width === 0 || height === 0) return

	const ctx = canvasEl.value.getContext('2d', { alpha: true })
	if (!ctx) return

	ctx.save()

	try {
		ctx.scale(pr, pr)

		// for stretching LODs - no smoothing to keep it crisp
		ctx.imageSmoothingEnabled = false

		const bitmap = getWaveform(props.audiofile, canvasWidth.value, props.audiofile.duration)

		if (bitmap) {
			ctx.clearRect(0, 0, canvasWidth.value, canvasWrapHeight.value)
			ctx.drawImage(bitmap, 0, 0, canvasWidth.value, canvasWrapHeight.value)

			ctx.globalCompositeOperation = 'source-in'

			const isCurrentPoolFile =
				withinAudioPool.value == true &&
				poolPreviewPlayingAudioId.value == props.audiofile.id &&
				poolPreviewPlayingAudioId.value

			const color = activeColors.value.waveform

			if (!isCurrentPoolFile) {
				// Mix with black (0.2 = 20% black)
				const mixed = interpolate([color, '#000000'])(0.2)
				const finalColor = formatHex(mixed) ?? props.audiofile.color
				ctx.fillStyle = finalColor
				ctx.fillRect(0, 0, canvasWidth.value, canvasWrapHeight.value)
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
				ctx.fillRect(0, 0, canvasWidth.value, canvasWrapHeight.value)
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
		canvasWrapHeight,
		canvasWidth,
		() => props.audiofile.waveforms,
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

watch([isSelected, () => activeColors.value.waveform], () => drawWaveform(), {
	immediate: false,
})

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

.clipHeader {
	grid-area: header;
	border-top-left-radius: inherit;
	border-top-right-radius: inherit;
	overflow: hidden;
	background-color: var(--_color);
}

.title {
	color: inherit;
	line-height: 1.2em;
	padding: 0 0.4rem 1px;
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

.gainDisplay {
	position: absolute;
	left: var(--relative-left, 50%);
	transform: translateX(-50%) translateY(-50%);
	bottom: 13%;
	pointer-events: none;
	user-select: none;
	background-color: color-mix(in lab, var(--bg-color) 66%, transparent);
	line-height: 1em;
	padding: 1px 4px 2px;
	border-radius: 4px;
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
