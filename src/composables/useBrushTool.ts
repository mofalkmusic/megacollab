import { useEventListener } from '@vueuse/core'
import { computed, reactive, shallowRef, watch, type ShallowRef } from 'vue'
import {
	activeTool,
	brushAudioFileId,
	brushSourceClip,
	audiofiles,
	clips,
	tracks,
	user,
	TOTAL_BEATS,
	pxTrackHeight,
	altKeyPressed,
	controlKeyPressed,
} from '@/state'
import { px_to_beats, quantize_beats, sec_to_beats } from '@/utils/mathUtils'
import { socket } from '@/socket/socket'
import { useConsole } from '@/composables/useConsole'
import { nanoid } from 'nanoid'
import type { Clip } from '~/schema'

export function useBrushTool(tracksWrapperEl: Readonly<ShallowRef<HTMLElement | null>>) {
	const { userLog } = useConsole()

	const isBrushActive = computed(
		() =>
			(activeTool.value === 'brush' || activeTool.value === 'magic-brush') &&
			!controlKeyPressed.value,
	)

	const brushDragState = shallowRef<{
		trackId: string
		nextRightBeat: number
		nextLeftBeat: number
		firstClipStartBeat: number
		direction: 'right' | 'left' | null
		placedClipIds: string[]
	} | null>(null)

	// --- Hover preview ---
	const brushPreview = reactive<{
		visible: boolean
		startBeat: number
		endBeat: number
		trackId: string | null
		topPx: number
	}>({
		visible: false,
		startBeat: 0,
		endBeat: 0,
		trackId: null,
		topPx: 0,
	})

	type BrushPlacementSource = {
		audioFileId: string
		lengthBeats: number
		offsetSeconds: number
		gain: number
	}

	function getAudioFile() {
		if (!brushAudioFileId.value) return null
		return audiofiles.get(brushAudioFileId.value) ?? null
	}

	function getBrushPlacementSource(): BrushPlacementSource | null {
		const audioFile = getAudioFile()
		if (!audioFile) return null

		if (brushSourceClip.value && brushSourceClip.value.audioFileId === audioFile.id) {
			return {
				audioFileId: audioFile.id,
				lengthBeats: Math.max(0.01, brushSourceClip.value.lengthBeats),
				offsetSeconds: Math.max(0, brushSourceClip.value.offsetSeconds),
				gain: brushSourceClip.value.gain,
			}
		}

		return {
			audioFileId: audioFile.id,
			lengthBeats: sec_to_beats(audioFile.duration),
			offsetSeconds: 0,
			gain: 1,
		}
	}

	/**
	 * Place a clip on the timeline.
	 * @param customEndBeat — if provided, overrides the natural end beat (for magic brush grid trimming)
	 */
	function placeClip(startBeat: number, trackId: string, customEndBeat?: number): string | null {
		const source = getBrushPlacementSource()
		if (!source || !user.value || user.value.banned_at) return null

		let endBeat = customEndBeat ?? startBeat + source.lengthBeats
		endBeat = Math.min(endBeat, TOTAL_BEATS)

		if (endBeat <= startBeat) return null

		const tempId = `__temp__${nanoid()}`
		const tempClip: Clip = {
			id: tempId,
			track_id: trackId,
			audio_file_id: source.audioFileId,
			creator_user_id: user.value.id,
			creator_display_name: user.value.display_name,
			start_beat: startBeat,
			end_beat: endBeat,
			offset_seconds: source.offsetSeconds,
			gain: source.gain,
			muted: false,
			created_at: new Date().toISOString(),
		}

		clips.set(tempId, tempClip)

		socket
			.emitWithAck('get:clip:create', {
				audio_file_id: source.audioFileId,
				track_id: trackId,
				start_beat: startBeat,
				end_beat: endBeat,
				offset_seconds: source.offsetSeconds,
				gain: source.gain,
				muted: false,
			})
			.then((res) => {
				if (res.success) {
					clips.delete(tempId)
					clips.set(res.data.id, res.data)
				} else {
					userLog('SYSTEM', `Failed to place clip: ${res.error.message}`, {
						textColor: 'red',
					})
					clips.delete(tempId)
				}
			})
			.catch(() => {
				clips.delete(tempId)
			})

		return tempId
	}

	function getClickPosition(
		e: PointerEvent,
	): { beat: number; trackId: string; topPx: number } | null {
		if (!tracksWrapperEl.value) return null

		const wrapperRect = tracksWrapperEl.value.getBoundingClientRect()

		// Find which track we're over
		const els = document.elementsFromPoint(e.clientX, e.clientY)
		const trackEl = els.find((el) => el.classList.contains('track')) as HTMLElement | undefined

		if (!trackEl) return null
		const trackId = trackEl.dataset.trackId
		if (!trackId) return null

		// Calculate beat position
		const relX = e.clientX - wrapperRect.left
		const rawBeat = px_to_beats(relX)

		const beat = altKeyPressed.value ? rawBeat : quantize_beats(rawBeat)

		// Calculate topPx relative to wrapper
		const trackRect = trackEl.getBoundingClientRect()
		const topPx = trackRect.top - wrapperRect.top

		return { beat: Math.max(0, beat), trackId, topPx }
	}

	/**
	 * For magic brush: compute grid-step = quantize(durationBeats) rounded up to nearest grid unit.
	 * This is the spacing between consecutive grid-placed clips.
	 */
	function getGridStep(): number {
		const source = getBrushPlacementSource()
		if (!source) return 1
		// Round up to next grid unit (1 beat by default quantize)
		return Math.max(1, Math.ceil(source.lengthBeats))
	}

	// Main handler — intercept pointerdown on tracks wrapper when brush active
	useEventListener(
		tracksWrapperEl,
		'pointerdown',
		(e) => {
			if (!isBrushActive.value) return
			if (controlKeyPressed.value) return // Allow Ctrl+click selection behavior to pass through to Index.vue
			if (!brushAudioFileId.value) {
				userLog(
					'SYSTEM',
					'No brush source selected. Drag from pool or click a clip in hand mode first.',
					{
						textColor: 'orange',
					},
				)
				return
			}
			if (e.button !== 0) return
			if (user.value?.banned_at) return

			// Don't intercept if clicking on the timeline header
			if ((e.target as HTMLElement).closest('.timeline-header-wrap')) return

			e.preventDefault()
			e.stopPropagation()

			const pos = getClickPosition(e)
			if (!pos) return

			const source = getBrushPlacementSource()
			if (!source) return
			const durationBeats = source.lengthBeats

			if (activeTool.value === 'magic-brush') {
				// Magic brush: trim clip to fit grid
				const gridStep = getGridStep()
				const snappedStart = altKeyPressed.value
					? pos.beat
					: Math.floor(pos.beat / gridStep) * gridStep
				const endBeat = snappedStart + gridStep // exact grid fit

				const firstClipId = placeClip(snappedStart, pos.trackId, endBeat)
				if (!firstClipId) return

				brushDragState.value = {
					trackId: pos.trackId,
					nextRightBeat: snappedStart + gridStep,
					nextLeftBeat: snappedStart - gridStep,
					firstClipStartBeat: snappedStart,
					direction: null,
					placedClipIds: [firstClipId],
				}
			} else {
				// Regular brush
				const firstClipId = placeClip(pos.beat, pos.trackId)
				if (!firstClipId) return

				brushDragState.value = {
					trackId: pos.trackId,
					nextRightBeat: pos.beat + durationBeats,
					nextLeftBeat: pos.beat - durationBeats,
					firstClipStartBeat: pos.beat,
					direction: null,
					placedClipIds: [firstClipId],
				}
			}

			const onMove = (me: PointerEvent) => {
				if (!brushDragState.value || !tracksWrapperEl.value) return

				me.preventDefault()

				const movePos = getClickPosition(me)
				if (!movePos) return

				const source = getBrushPlacementSource()
				if (!source) return
				const durationBeats = source.lengthBeats

				const state = brushDragState.value

				// Determine direction on first move
				if (state.direction === null) {
					if (movePos.beat > state.firstClipStartBeat) {
						state.direction = 'right'
					} else if (movePos.beat < state.firstClipStartBeat) {
						state.direction = 'left'
					}
				}

				if (activeTool.value === 'brush') {
					// --- BRUSH: consecutive placement ---
					if (state.direction === 'right') {
						// Place clips back-to-back rightward while mouse is past next position
						while (
							movePos.beat >= state.nextRightBeat &&
							state.nextRightBeat < TOTAL_BEATS
						) {
							const clipId = placeClip(state.nextRightBeat, movePos.trackId)
							if (clipId) {
								state.placedClipIds.push(clipId)
								state.nextRightBeat += durationBeats
							} else {
								break
							}
						}
					} else if (state.direction === 'left') {
						// Place clips leftward
						while (movePos.beat <= state.nextLeftBeat && state.nextLeftBeat >= 0) {
							const clipId = placeClip(state.nextLeftBeat, movePos.trackId)
							if (clipId) {
								state.placedClipIds.push(clipId)
								state.nextLeftBeat -= durationBeats
							} else {
								break
							}
						}
					}
				} else if (activeTool.value === 'magic-brush') {
					// --- MAGIC BRUSH: grid-snapped, trimmed to grid ---
					const gridStep = getGridStep()

					if (state.direction === 'right') {
						while (
							movePos.beat >= state.nextRightBeat &&
							state.nextRightBeat < TOTAL_BEATS
						) {
							const endBeat = state.nextRightBeat + gridStep
							const clipId = placeClip(state.nextRightBeat, movePos.trackId, endBeat)
							if (clipId) {
								state.placedClipIds.push(clipId)
								state.nextRightBeat += gridStep
							} else {
								break
							}
						}
					} else if (state.direction === 'left') {
						while (movePos.beat <= state.nextLeftBeat && state.nextLeftBeat >= 0) {
							const endBeat = state.nextLeftBeat + gridStep
							const clipId = placeClip(state.nextLeftBeat, movePos.trackId, endBeat)
							if (clipId) {
								state.placedClipIds.push(clipId)
								state.nextLeftBeat -= gridStep
							} else {
								break
							}
						}
					}
				}

				brushDragState.value = { ...state }
			}

			const onUp = () => {
				stopMove()
				stopUp()
				brushDragState.value = null
			}

			const stopMove = useEventListener(window, 'pointermove', onMove)
			const stopUp = useEventListener(window, 'pointerup', onUp)
		},
		{ passive: false },
	)

	// --- Hover preview tracking ---
	useEventListener(tracksWrapperEl, 'pointermove', (e) => {
		if (!isBrushActive.value || brushDragState.value) {
			brushPreview.visible = false
			return
		}
		if (!brushAudioFileId.value) {
			brushPreview.visible = false
			return
		}

		const pos = getClickPosition(e)
		if (!pos) {
			brushPreview.visible = false
			return
		}

		const source = getBrushPlacementSource()
		if (!source) {
			brushPreview.visible = false
			return
		}

		const durationBeats = source.lengthBeats

		let startBeat: number
		let endBeat: number

		if (activeTool.value === 'magic-brush') {
			const gridStep = getGridStep()
			startBeat = altKeyPressed.value ? pos.beat : Math.floor(pos.beat / gridStep) * gridStep
			endBeat = startBeat + gridStep
		} else {
			startBeat = pos.beat
			endBeat = startBeat + durationBeats
		}

		endBeat = Math.min(endBeat, TOTAL_BEATS)

		brushPreview.visible = true
		brushPreview.startBeat = startBeat
		brushPreview.endBeat = endBeat
		brushPreview.trackId = pos.trackId
		brushPreview.topPx = pos.topPx
	})

	useEventListener(tracksWrapperEl, 'pointerleave', () => {
		brushPreview.visible = false
	})

	// Hide preview during drag
	watch(brushDragState, (state) => {
		if (state) brushPreview.visible = false
	})

	// Set cursor when brush is active
	watch(
		isBrushActive,
		(active) => {
			if (active) {
				document.body.style.cursor = 'crosshair'
			} else {
				document.body.style.cursor = ''
				brushPreview.visible = false
			}
		},
		{ immediate: true },
	)

	return { brushDragState, brushPreview }
}
