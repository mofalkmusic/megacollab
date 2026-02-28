<template>
	<div
		v-memo="[
			wrapperStyles,
			waveformsDrawn,
			canvasStyles,
			props.audiofile.file_name,
			props.clip?.muted,
			isHovered,
			isSelected,
			!!dragSession,
		]"
		ref="clipWrapper"
		class="outmostClipWrapper clip"
		:data-clip-id="props.clip?.id"
		:class="{ selected: isSelected, muted: !!props.clip?.muted, 'is-dragging': !!dragSession }"
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
	shiftKeyPressed,
	clips,
	controlKeyPressed,
	dragFromPoolState,
	pixelRatio,
	user,
	selectedClipIds,
	activeTool,
	brushAudioFileId,
	brushSourceClip,
	multiDragState,
	tracks,
	pxTrackHeight,
	audioPoolPreviewOnClick,
	cloneDragPreview,
} from '@/state'
import type { Clip } from '~/schema'
import {
	useElementBounding,
	useEventListener,
	watchThrottled,
	useElementHover,
	useWindowFocus,
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
import { Trash2 } from 'lucide-vue-next'
import { deleteAudio } from '@/socket/eventHandlers/audiofile_delete'
import { useConsole } from '@/composables/useConsole'
import { nanoid } from 'nanoid'
import { previewAudioFile } from '@/audioEngine'

const { userLog } = useConsole()

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
	const clipId = props.clip.id
	const res = await socket.emitWithAck('get:clip:delete', { id: clipId })

	if (res.success) {
		clips.delete(res.data.id)
		selectedClipIds.delete(res.data.id)
		return
	}

	const message = res.error?.message ?? ''
	// Idempotent behavior for races: clip may already be deleted on server.
	if (message.includes('Failed to delete clip')) {
		clips.delete(clipId)
		selectedClipIds.delete(clipId)
	}
}

async function sliceClipAtPointer(clientX: number) {
	if (!props.clip || !wrapperEl.value) return
	if (user.value?.banned_at) return

	const clip = clips.get(props.clip.id)
	if (!clip) return

	// Let the optimistic create flow finish first for temp clips.
	if (clip.id.startsWith('__temp__')) return

	const rect = wrapperEl.value.getBoundingClientRect()
	const localX = clientX - rect.left
	const rawCutBeat = clip.start_beat + px_to_beats(localX)
	let cutBeat = altKeyPressed.value ? rawCutBeat : quantize_beats(rawCutBeat)

	cutBeat = Math.max(clip.start_beat, Math.min(clip.end_beat, cutBeat))
	const epsilon = 0.0001
	if (cutBeat <= clip.start_beat + epsilon || cutBeat >= clip.end_beat - epsilon) return

	const originalStartBeat = clip.start_beat
	const originalEndBeat = clip.end_beat
	const originalOffsetSeconds = clip.offset_seconds
	const originalTrackId = clip.track_id
	const secondOffsetSeconds = originalOffsetSeconds + beats_to_sec(cutBeat - originalStartBeat)

	// Optimistic split preview.
	clip.end_beat = cutBeat
	const tempSecondId = `__temp__${nanoid()}`
	const tempSecondClip: Clip = {
		...clip,
		id: tempSecondId,
		start_beat: cutBeat,
		end_beat: originalEndBeat,
		offset_seconds: secondOffsetSeconds,
		created_at: new Date().toISOString(),
	}
	clips.set(tempSecondId, tempSecondClip)

	const updateRes = await socket.emitWithAck('get:clip:update', {
		id: clip.id,
		changes: {
			end_beat: cutBeat,
		},
	})

	if (!updateRes.success) {
		clip.end_beat = originalEndBeat
		clips.delete(tempSecondId)
		userLog('SYSTEM', `Failed to slice clip: ${updateRes.error.message}`, {
			textColor: 'red',
		})
		return
	}

	const persistedCutBeat = updateRes.data['end_beat'] ?? cutBeat
	clip.end_beat = persistedCutBeat
	const persistedSecondOffset =
		originalOffsetSeconds + beats_to_sec(persistedCutBeat - originalStartBeat)

	const createRes = await socket.emitWithAck('get:clip:create', {
		audio_file_id: clip.audio_file_id,
		track_id: originalTrackId,
		start_beat: persistedCutBeat,
		end_beat: originalEndBeat,
		offset_seconds: persistedSecondOffset,
		gain: clip.gain,
		muted: clip.muted,
	})

	if (createRes.success) {
		clips.delete(tempSecondId)
		clips.set(createRes.data.id, createRes.data)
		selectedClipIds.clear()
		return
	}

	// Roll back split if second half creation failed.
	clips.delete(tempSecondId)
	const restoreRes = await socket.emitWithAck('get:clip:update', {
		id: clip.id,
		changes: {
			end_beat: originalEndBeat,
		},
	})

	if (restoreRes.success) {
		clip.end_beat = restoreRes.data['end_beat'] ?? originalEndBeat
	} else {
		clip.end_beat = originalEndBeat
	}

	userLog('SYSTEM', `Failed to slice clip: ${createRes.error.message}`, {
		textColor: 'red',
	})
}

async function createClipClone(
	sourceClip: Clip,
	opts: { startBeat: number; endBeat: number; trackId: string },
) {
	if (user.value?.banned_at) return
	if (sourceClip.id.startsWith('__temp__')) return

	const tempId = `__temp__${nanoid()}`
	const tempClone: Clip = {
		...sourceClip,
		id: tempId,
		track_id: opts.trackId,
		start_beat: opts.startBeat,
		end_beat: opts.endBeat,
		creator_user_id: user.value?.id ?? sourceClip.creator_user_id,
		creator_display_name: user.value?.display_name ?? sourceClip.creator_display_name,
		created_at: new Date().toISOString(),
	}

	clips.set(tempId, tempClone)

	const res = await socket.emitWithAck('get:clip:create', {
		audio_file_id: sourceClip.audio_file_id,
		track_id: opts.trackId,
		start_beat: opts.startBeat,
		end_beat: opts.endBeat,
		offset_seconds: sourceClip.offset_seconds,
		gain: sourceClip.gain,
		muted: sourceClip.muted,
	})

	if (res.success) {
		clips.delete(tempId)
		clips.set(res.data.id, res.data)
		return
	}

	clips.delete(tempId)
	userLog('SYSTEM', `Failed to clone clip: ${res.error.message}`, {
		textColor: 'red',
	})
}

type ClipMoveSnapshot = {
	startBeat: number
	endBeat: number
	trackId: string
}

function rollbackMoveIfUnchanged(
	clipId: string,
	expected: ClipMoveSnapshot,
	previous: ClipMoveSnapshot,
) {
	const current = clips.get(clipId)
	if (!current) return

	if (
		current.start_beat !== expected.startBeat ||
		current.end_beat !== expected.endBeat ||
		current.track_id !== expected.trackId
	) {
		return
	}

	current.start_beat = previous.startBeat
	current.end_beat = previous.endBeat
	current.track_id = previous.trackId
}

function setBrushSourceFromClip(clip: Clip) {
	brushAudioFileId.value = clip.audio_file_id
	brushSourceClip.value = {
		audioFileId: clip.audio_file_id,
		lengthBeats: Math.max(0.01, clip.end_beat - clip.start_beat),
		offsetSeconds: clip.offset_seconds,
		gain: clip.gain,
	}
}

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
const isSelected = computed(() => {
	if (!props.clip) return false
	return selectedClipIds.has(props.clip.id)
})

const isPartOfMultiDrag = computed(() => {
	return isSelected.value && multiDragState.value !== null
})

const displayState = computed(() => {
	if (dragSession.value && !dragSession.value.cloneSourceClipId) {
		return {
			start_beat: dragSession.value.previewStartBeat,
			end_beat: dragSession.value.previewEndBeat,
			offset_seconds: dragSession.value.previewOffsetSec,
		}
	}
	if (isPartOfMultiDrag.value && multiDragState.value) {
		const snap = multiDragState.value.clipSnapshots.get(props.clip!.id)
		if (snap) {
			const start = snap.origStartBeat + multiDragState.value.deltaBeats
			return {
				start_beat: start,
				end_beat: snap.origEndBeat + multiDragState.value.deltaBeats,
				offset_seconds: props.clip!.offset_seconds,
			}
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

	if (
		dragSession.value &&
		dragSession.value.side === 'move' &&
		!dragSession.value.cloneSourceClipId
	) {
		const offset = dragSession.value.verticalOffsetPx
		if (offset !== 0) {
			base.top = `${offset}px`
		}
	} else if (
		isPartOfMultiDrag.value &&
		multiDragState.value &&
		multiDragState.value.trackDelta !== 0
	) {
		// Multi-drag vertical movement visual offset
		const snap = multiDragState.value.clipSnapshots.get(props.clip!.id)
		if (snap && wrapperEl.value) {
			const sorted = [...tracks.entries()].sort((a, b) => a[1].order_index - b[1].order_index)
			const origTrackIdx = sorted.findIndex(([id]) => id === snap.origTrackId)
			if (origTrackIdx !== -1) {
				let targetTrackIdx = origTrackIdx + multiDragState.value.trackDelta
				targetTrackIdx = Math.max(0, Math.min(sorted.length - 1, targetTrackIdx))

				if (targetTrackIdx !== origTrackIdx) {
					// We need to calculate pixel offset between orig track and target track
					// This is tricky because we are inside the original track DOM
					const offset = (targetTrackIdx - origTrackIdx) * pxTrackHeight
					base.top = `${offset}px`
				}
			}
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
	cloneSourceClipId: string | null
	sourceTrackRect?: DOMRect
} | null>(null)

function clearOwnedMultiDrag() {
	if (!props.clip || !multiDragState.value) return
	if (multiDragState.value.sourceClipId === props.clip.id) {
		multiDragState.value = null
	}
}

function clearCloneDragPreview() {
	cloneDragPreview.visible = false
	cloneDragPreview.trackId = null
	cloneDragPreview.audioFileId = null
	cloneDragPreview.muted = false
}

function getTrackTopWithinTracksWrapper(trackRect?: DOMRect): number {
	if (!trackRect || !wrapperEl.value) return 0
	const tracksWrapper = wrapperEl.value.closest('.all-tracks-wrapper') as HTMLElement | null
	if (!tracksWrapper) return 0
	const wrapperRect = tracksWrapper.getBoundingClientRect()
	return trackRect.top - wrapperRect.top
}

const windowFocused = useWindowFocus()
watch(windowFocused, (focused) => {
	if (!focused) {
		dragSession.value = null
		clearOwnedMultiDrag()
		clearCloneDragPreview()
	}
})

// functionality for timeline clips

onMounted(() => {
	if (withinAudioPool.value) {
		if (!wrapperEl.value) return

		useEventListener(wrapperEl, 'pointerdown', (event) => {
			if (user.value?.banned_at) return
			if (event.button !== 0) return
			event.preventDefault()

			const rect = wrapperEl.value!.getBoundingClientRect()
			const offsetX = event.clientX - rect.left

			dragFromPoolState.value = {
				audioFileId: props.audiofile.id,
				offsetPx: offsetX,
				clientX: event.clientX,
				clientY: event.clientY,
			}

			const startX = event.clientX
			const startY = event.clientY
			const dragThreshold = 5
			const dragThresholdSq = dragThreshold * dragThreshold
			let moved = false

			const onMove = (e: PointerEvent) => {
				if (moved) return
				const dx = e.clientX - startX
				const dy = e.clientY - startY
				moved = dx * dx + dy * dy > dragThresholdSq
			}

			const onUp = () => {
				stopMove()
				stopUp()

				if (moved) return
				if (!audioPoolPreviewOnClick.value) return
				void previewAudioFile(props.audiofile.id)
			}

			const stopMove = useEventListener(window, 'pointermove', onMove)
			const stopUp = useEventListener(window, 'pointerup', onUp)
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

			if (event.button !== 0) return
			if (cloneDragPreview.visible) clearCloneDragPreview()
			if (controlKeyPressed.value) {
				// Ctrl+click: toggle this clip in/out of selection
				if (props.clip) {
					if (selectedClipIds.has(props.clip.id)) {
						selectedClipIds.delete(props.clip.id)
					} else {
						selectedClipIds.add(props.clip.id)
					}
				}
				event.preventDefault()
				event.stopPropagation()
				return
			}

			if (props.clip && activeTool.value === 'hand') {
				setBrushSourceFromClip(props.clip)
			}

			if (activeTool.value === 'mute') {
				return
			}

			// In brush modes, clicking an existing clip acts as an eyedropper:
			// update brush source only on a true click (not a drag),
			// without moving or placing on this interaction.
			if (
				props.clip &&
				(activeTool.value === 'brush' || activeTool.value === 'magic-brush')
			) {
				event.preventDefault()
				event.stopPropagation()
				clearOwnedMultiDrag()

				const sourceClipId = props.clip.id
				const startX = event.clientX
				const startY = event.clientY
				const dragThresholdPx = 5
				const dragThresholdSq = dragThresholdPx * dragThresholdPx
				let moved = false

				const onMove = (e: PointerEvent) => {
					if (moved) return
					const dx = e.clientX - startX
					const dy = e.clientY - startY
					moved = dx * dx + dy * dy > dragThresholdSq
				}

				const onUp = () => {
					stopMove()
					stopUp()
					if (moved) return

					const sourceClip = clips.get(sourceClipId)
					if (!sourceClip) return
					setBrushSourceFromClip(sourceClip)
				}

				const stopMove = useEventListener(window, 'pointermove', onMove)
				const stopUp = useEventListener(window, 'pointerup', onUp)
				return
			}

			event.preventDefault()
			event.stopPropagation()
			clearOwnedMultiDrag()

			if (activeTool.value === 'slice') {
				void sliceClipAtPointer(event.clientX)
				return
			}

			const parentTrack = (event.currentTarget as HTMLElement).closest('.track')

			let sRect: DOMRect | undefined
			if (parentTrack) {
				sRect = parentTrack.getBoundingClientRect()
			}
			const isShiftCloneDrag =
				!!props.clip && activeTool.value === 'hand' && shiftKeyPressed.value

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
				cloneSourceClipId: isShiftCloneDrag ? props.clip!.id : null,
				sourceTrackRect: sRect,
			}

			if (isShiftCloneDrag && props.clip) {
				cloneDragPreview.visible = true
				cloneDragPreview.trackId = props.clip.track_id
				cloneDragPreview.audioFileId = props.clip.audio_file_id
				cloneDragPreview.startBeat = initialClipState.value.start_beat
				cloneDragPreview.endBeat = initialClipState.value.end_beat
				cloneDragPreview.offsetSeconds = props.clip.offset_seconds
				cloneDragPreview.gain = props.clip.gain
				cloneDragPreview.muted = props.clip.muted
				cloneDragPreview.topPx = getTrackTopWithinTracksWrapper(sRect)
			} else {
				clearCloneDragPreview()
			}

			const el = event.currentTarget as HTMLElement
			el.setPointerCapture(event.pointerId)

			// Initialize multi-drag if this clip is part of a selection
			if (!isShiftCloneDrag && isSelected.value && !controlKeyPressed.value) {
				const snapshots = new Map()
				for (const id of selectedClipIds) {
					const c = clips.get(id)
					if (c) {
						snapshots.set(id, {
							origStartBeat: c.start_beat,
							origEndBeat: c.end_beat,
							origTrackId: c.track_id,
						})
					}
				}
				multiDragState.value = {
					startX: event.clientX,
					startY: event.clientY,
					deltaBeats: 0,
					trackDelta: 0,
					sourceClipId: props.clip!.id,
					clipSnapshots: snapshots,
				}
			}

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
				const isLeaderOfMultiDrag =
					multiDragState.value && multiDragState.value.sourceClipId === props.clip!.id
				let clampedDeltaBeats = deltaBeats

				if (isLeaderOfMultiDrag && multiDragState.value) {
					let minStartBeat = Number.POSITIVE_INFINITY
					let maxEndBeat = Number.NEGATIVE_INFINITY

					for (const snap of multiDragState.value.clipSnapshots.values()) {
						minStartBeat = Math.min(minStartBeat, snap.origStartBeat)
						maxEndBeat = Math.max(maxEndBeat, snap.origEndBeat)
					}

					if (
						Number.isFinite(minStartBeat) &&
						Number.isFinite(maxEndBeat) &&
						minStartBeat !== Number.POSITIVE_INFINITY &&
						maxEndBeat !== Number.NEGATIVE_INFINITY
					) {
						const minDelta = -minStartBeat
						const maxDelta = TOTAL_BEATS - maxEndBeat
						clampedDeltaBeats = Math.max(minDelta, Math.min(maxDelta, deltaBeats))
					}
				}

				const currentDuration = sesh.origEndBeat - sesh.origStartBeat
				let newStart: number
				let newEnd: number
				if (isLeaderOfMultiDrag) {
					newStart = sesh.origStartBeat + clampedDeltaBeats
					newEnd = sesh.origEndBeat + clampedDeltaBeats
				} else {
					newStart = sesh.origStartBeat + clampedDeltaBeats
					newStart = Math.max(0, newStart)
					newEnd = newStart + currentDuration
					newEnd = Math.min(newEnd, TOTAL_BEATS)
				}

				sesh.previewStartBeat = newStart
				sesh.previewEndBeat = newEnd

				// --- VERTICAL ---
				const els = document.elementsFromPoint(e.clientX, e.clientY)
				const trackEl = els.find((el) => el.classList.contains('track')) as
					| HTMLElement
					| undefined

				if (trackEl && sesh.sourceTrackRect) {
					const targetRect = trackEl.getBoundingClientRect()
					// Snap visual to track top difference
					const snapY = targetRect.top - sesh.sourceTrackRect.top

					sesh.verticalOffsetPx = snapY
					sesh.previewTrackId = trackEl.dataset.trackId ?? null

					if (sesh.cloneSourceClipId) {
						cloneDragPreview.topPx = getTrackTopWithinTracksWrapper(targetRect)
					}
				}

				if (sesh.cloneSourceClipId) {
					cloneDragPreview.visible = true
					cloneDragPreview.trackId = sesh.previewTrackId
					cloneDragPreview.startBeat = sesh.previewStartBeat
					cloneDragPreview.endBeat = sesh.previewEndBeat
				}

				// Update global multi-drag state if we are the leader
				if (isLeaderOfMultiDrag && multiDragState.value) {
					const state = multiDragState.value
					const sorted = [...tracks.entries()].sort(
						(a, b) => a[1].order_index - b[1].order_index,
					)
					const origTrackIdx = sorted.findIndex(([id]) => id === props.clip!.track_id)
					const hoveredTrackIdx = sesh.previewTrackId
						? sorted.findIndex(([id]) => id === sesh.previewTrackId)
						: -1
					const rawTrackDelta =
						origTrackIdx !== -1 && hoveredTrackIdx !== -1
							? hoveredTrackIdx - origTrackIdx
							: state.trackDelta

					let minOrigTrackIdx = Number.POSITIVE_INFINITY
					let maxOrigTrackIdx = Number.NEGATIVE_INFINITY
					for (const snap of state.clipSnapshots.values()) {
						const idx = sorted.findIndex(([id]) => id === snap.origTrackId)
						if (idx === -1) continue
						minOrigTrackIdx = Math.min(minOrigTrackIdx, idx)
						maxOrigTrackIdx = Math.max(maxOrigTrackIdx, idx)
					}

					let clampedTrackDelta = rawTrackDelta
					if (
						Number.isFinite(minOrigTrackIdx) &&
						Number.isFinite(maxOrigTrackIdx) &&
						minOrigTrackIdx !== Number.POSITIVE_INFINITY &&
						maxOrigTrackIdx !== Number.NEGATIVE_INFINITY
					) {
						const minTrackDelta = -minOrigTrackIdx
						const maxTrackDelta = sorted.length - 1 - maxOrigTrackIdx
						clampedTrackDelta = Math.max(
							minTrackDelta,
							Math.min(maxTrackDelta, rawTrackDelta),
						)
					}

					if (origTrackIdx !== -1) {
						const clampedLeaderIdx = origTrackIdx + clampedTrackDelta
						if (clampedLeaderIdx >= 0 && clampedLeaderIdx < sorted.length) {
							sesh.previewTrackId = sorted[clampedLeaderIdx]![0]
							sesh.verticalOffsetPx =
								(clampedLeaderIdx - origTrackIdx) * pxTrackHeight
						}
					}

					multiDragState.value = {
						...state,
						deltaBeats: clampedDeltaBeats,
						trackDelta: clampedTrackDelta,
					}
				}
			}

			const onUp = async (e: PointerEvent) => {
				el.releasePointerCapture(e.pointerId)
				stopMove()
				stopUp()

				const sesh = dragSession.value
				if (!sesh || !props.clip) {
					clearOwnedMultiDrag()
					clearCloneDragPreview()
					dragSession.value = null
					return
				}

				const leaderClipId = props.clip.id
				const isLeaderOfMultiDrag =
					multiDragState.value && multiDragState.value.sourceClipId === leaderClipId

				try {
					if (isLeaderOfMultiDrag && multiDragState.value) {
						const state = multiDragState.value
						const sorted = [...tracks.entries()].sort(
							(a, b) => a[1].order_index - b[1].order_index,
						)

						// Commit changes for all clips in the selection
						for (const [id, snap] of state.clipSnapshots) {
							const clip = clips.get(id)
							if (!clip) continue

							const newStart = snap.origStartBeat + state.deltaBeats
							const newEnd = snap.origEndBeat + state.deltaBeats

							const origTrackIdx = sorted.findIndex(
								([tid]) => tid === snap.origTrackId,
							)
							const targetTrackIdx =
								origTrackIdx !== -1 ? origTrackIdx + state.trackDelta : -1
							const targetTrackId =
								sorted.length > 0 &&
								targetTrackIdx >= 0 &&
								targetTrackIdx < sorted.length
									? sorted[targetTrackIdx]![0]
									: snap.origTrackId
							const previousSnapshot: ClipMoveSnapshot = {
								startBeat: clip.start_beat,
								endBeat: clip.end_beat,
								trackId: clip.track_id,
							}
							const expectedSnapshot: ClipMoveSnapshot = {
								startBeat: newStart,
								endBeat: newEnd,
								trackId: targetTrackId,
							}

							// Optimistic update
							clip.start_beat = newStart
							clip.end_beat = newEnd
							if (targetTrackId) clip.track_id = targetTrackId

							// Temp clips are local-only optimistic placeholders.
							if (clip.id.startsWith('__temp__')) continue

							const changes: any = {
								start_beat: newStart,
								end_beat: newEnd,
							}
							if (targetTrackId !== previousSnapshot.trackId) {
								changes.track_id = targetTrackId
							}

							socket
								.emitWithAck('get:clip:update', {
									id: clip.id,
									changes,
								})
								.then((res) => {
									if (res.success) {
										clip.start_beat = res.data['start_beat'] ?? newStart
										clip.end_beat = res.data['end_beat'] ?? newEnd
										if (res.data['track_id'])
											clip.track_id = res.data['track_id']
										return
									}

									rollbackMoveIfUnchanged(id, expectedSnapshot, previousSnapshot)
									userLog('SYSTEM', `Failed to move clip: ${res.error.message}`, {
										textColor: 'red',
									})
								})
								.catch(() => {
									rollbackMoveIfUnchanged(id, expectedSnapshot, previousSnapshot)
									userLog('SYSTEM', 'Failed to move clip: network error.', {
										textColor: 'red',
									})
								})
						}
					} else {
						// Single clip commit (standard logic)
						const clip = clips.get(props.clip.id)
						if (!clip) return

						if (sesh.cloneSourceClipId) {
							const sourceClip = clips.get(sesh.cloneSourceClipId)
							if (!sourceClip) return

							await createClipClone(sourceClip, {
								startBeat: sesh.previewStartBeat,
								endBeat: sesh.previewEndBeat,
								trackId: sesh.previewTrackId ?? sourceClip.track_id,
							})
							return
						}

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
							return
						}

						const previousSnapshot: ClipMoveSnapshot = {
							startBeat: clip.start_beat,
							endBeat: clip.end_beat,
							trackId: clip.track_id,
						}
						const expectedSnapshot: ClipMoveSnapshot = {
							startBeat: sesh.previewStartBeat,
							endBeat: sesh.previewEndBeat,
							trackId: sesh.previewTrackId ?? clip.track_id,
						}

						// Optimistic update
						clip.start_beat = sesh.previewStartBeat
						clip.end_beat = sesh.previewEndBeat
						if (sesh.previewTrackId) clip.track_id = sesh.previewTrackId

						try {
							const res = await socket.emitWithAck('get:clip:update', {
								id: clip.id,
								changes,
							})

							if (res.success) {
								clip.start_beat = res.data['start_beat'] ?? sesh.previewStartBeat
								clip.end_beat = res.data['end_beat'] ?? sesh.previewEndBeat
								if (res.data['track_id']) clip.track_id = res.data['track_id']
							} else {
								rollbackMoveIfUnchanged(clip.id, expectedSnapshot, previousSnapshot)
								userLog('SYSTEM', `Failed to move clip: ${res.error.message}`, {
									textColor: 'red',
								})
							}
						} catch {
							rollbackMoveIfUnchanged(clip.id, expectedSnapshot, previousSnapshot)
							userLog('SYSTEM', 'Failed to move clip: network error.', {
								textColor: 'red',
							})
						}
					}
				} finally {
					clearOwnedMultiDrag()
					clearCloneDragPreview()
					dragSession.value = null
				}
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
			if (user.value?.banned_at) return

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
				cloneSourceClipId: null,
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
			if (user.value?.banned_at) return

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
				cloneSourceClipId: null,
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
		const mixed = interpolate([
			isSelected.value ? '#ff4444' : props.audiofile.color,
			'#000000',
		])(0.2)
		const finalColor = formatHex(mixed) ?? props.audiofile.color
		ctx.fillStyle = finalColor
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

.outmostClipWrapper.muted:not(.selected) {
	opacity: 0.5;
	filter: grayscale(1) saturate(0.2);
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
