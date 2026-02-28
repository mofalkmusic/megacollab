import { useEventListener } from '@vueuse/core'
import { computed } from 'vue'
import {
	clips,
	selectedClipIds,
	clipboardClips,
	tracks,
	user,
	TOTAL_BEATS,
	type ClipboardEntry,
} from '@/state'
import { currentPlayTimeBeats } from '@/audioEngine'
import { quantize_beats } from '@/utils/mathUtils'
import { socket } from '@/socket/socket'
import { useConsole } from '@/composables/useConsole'
import { nanoid } from 'nanoid'
import type { Clip } from '~/schema'

type ClipboardActionsOptions = {
	bindKeyboard?: boolean
}

export function useClipboardActions(options: ClipboardActionsOptions = {}) {
	const { userLog } = useConsole()
	const { bindKeyboard = true } = options

	// Sorted tracks for index-based track offset lookup
	const sortedTrackIds = computed(() =>
		[...tracks.entries()].sort((a, b) => a[1].order_index - b[1].order_index).map(([id]) => id),
	)

	function getTrackIndex(trackId: string): number {
		return sortedTrackIds.value.indexOf(trackId)
	}

	// --- COPY ---
	function copySelection() {
		if (selectedClipIds.size === 0) return
		if (user.value?.banned_at) return

		const selected: Clip[] = []
		for (const id of selectedClipIds) {
			const clip = clips.get(id)
			if (clip) selected.push(clip)
		}
		if (selected.length === 0) return

		// Find leftmost beat and lowest track index
		const minBeat = Math.min(...selected.map((c) => c.start_beat))
		const trackIndices = selected.map((c) => getTrackIndex(c.track_id))
		const minTrackIndex = Math.min(...trackIndices)

		const entries: ClipboardEntry[] = selected.map((c) => ({
			relStartBeat: c.start_beat - minBeat,
			relEndBeat: c.end_beat - minBeat,
			trackOffset: getTrackIndex(c.track_id) - minTrackIndex,
			audioFileId: c.audio_file_id,
			offsetSeconds: c.offset_seconds,
			gain: c.gain,
			muted: c.muted,
		}))

		clipboardClips.value = entries
		userLog('SYSTEM', `Copied ${entries.length} clip(s)`, { textColor: 'cyan' })
	}

	// --- PASTE ---
	async function pasteClips() {
		if (!clipboardClips.value || clipboardClips.value.length === 0) return
		if (user.value?.banned_at) return

		const entries = clipboardClips.value

		// Determine paste position: use playhead if > 0, else after selection, else beat 0
		let pasteAtBeat = quantize_beats(currentPlayTimeBeats.value)

		if (pasteAtBeat <= 0 && selectedClipIds.size > 0) {
			// Paste after rightmost selected clip
			let maxEnd = 0
			for (const id of selectedClipIds) {
				const c = clips.get(id)
				if (c && c.end_beat > maxEnd) maxEnd = c.end_beat
			}
			pasteAtBeat = quantize_beats(maxEnd)
		}

		// Determine target base track index
		let baseTrackIndex = 0
		if (selectedClipIds.size > 0) {
			const selectedTrackIndices = [...selectedClipIds]
				.map((id) => clips.get(id))
				.filter(Boolean)
				.map((c) => getTrackIndex(c!.track_id))
			baseTrackIndex = Math.min(...selectedTrackIndices)
		}

		const maxTrackIndex = sortedTrackIds.value.length - 1

		// Clear selection and select pasted clips
		selectedClipIds.clear()

		const requests: Array<{
			audio_file_id: string
			track_id: string
			start_beat: number
			end_beat: number
			offset_seconds: number
			gain: number
			muted: boolean
		}> = []
		const tempIds: string[] = []
		let skippedOutOfBounds = 0

		for (const entry of entries) {
			const targetTrackIndex = Math.min(baseTrackIndex + entry.trackOffset, maxTrackIndex)
			const targetTrackId = sortedTrackIds.value[targetTrackIndex]
			if (!targetTrackId) continue

			const startBeat = Math.max(0, pasteAtBeat + entry.relStartBeat)
			const endBeat = Math.min(TOTAL_BEATS, pasteAtBeat + entry.relEndBeat)
			if (endBeat <= startBeat) {
				skippedOutOfBounds++
				continue
			}

			requests.push({
				audio_file_id: entry.audioFileId,
				track_id: targetTrackId,
				start_beat: startBeat,
				end_beat: endBeat,
				offset_seconds: entry.offsetSeconds,
				gain: entry.gain,
				muted: entry.muted ?? false,
			})

			// Optimistic temp clip
			const tempId = `__temp__${nanoid()}`
			const tempClip: Clip = {
				id: tempId,
				track_id: targetTrackId,
				audio_file_id: entry.audioFileId,
				creator_user_id: user.value!.id,
				creator_display_name: user.value!.display_name,
				start_beat: startBeat,
				end_beat: endBeat,
				offset_seconds: entry.offsetSeconds,
				gain: entry.gain,
				muted: entry.muted ?? false,
				created_at: new Date().toISOString(),
			}

			tempIds.push(tempId)
			clips.set(tempId, tempClip)
			selectedClipIds.add(tempId)
		}

		if (requests.length === 0) {
			userLog('SYSTEM', 'Nothing pasted: clips would be outside timeline bounds.', {
				textColor: 'orange',
			})
			return
		}

		const res = await socket.emitWithAck('get:clips:create:batch', { clips: requests })
		let pastedCount = 0

		if (res.success) {
			for (const tempId of tempIds) {
				clips.delete(tempId)
				selectedClipIds.delete(tempId)
			}

			for (const clip of res.data) {
				clips.set(clip.id, clip)
				selectedClipIds.add(clip.id)
			}
			pastedCount = res.data.length
		} else {
			for (const tempId of tempIds) {
				clips.delete(tempId)
				selectedClipIds.delete(tempId)
			}
			userLog('SYSTEM', `Failed to paste clips: ${res.error.message}`, {
				textColor: 'red',
			})
		}

		if (pastedCount > 0) {
			const skippedMsg =
				skippedOutOfBounds > 0 ? ` (${skippedOutOfBounds} skipped out of bounds)` : ''
			userLog('SYSTEM', `Pasted ${pastedCount} clip(s)${skippedMsg}`, { textColor: 'cyan' })
		}
	}

	// --- DUPLICATE ---
	async function duplicateSelection() {
		if (selectedClipIds.size === 0) return
		if (user.value?.banned_at) return

		const selected: Clip[] = []
		for (const id of selectedClipIds) {
			const clip = clips.get(id)
			if (clip) selected.push(clip)
		}
		if (selected.length === 0) return

		// Width of selection = rightmost end - leftmost start
		const minBeat = Math.min(...selected.map((c) => c.start_beat))
		const maxEnd = Math.max(...selected.map((c) => c.end_beat))
		const selectionWidth = maxEnd - minBeat

		// Clear current selection, will select duplicated clips
		selectedClipIds.clear()

		let queued = 0
		let skippedOutOfBounds = 0

		for (const c of selected) {
			const startBeat = Math.max(0, c.start_beat + selectionWidth)
			const endBeat = Math.min(TOTAL_BEATS, c.end_beat + selectionWidth)
			if (endBeat <= startBeat) {
				skippedOutOfBounds++
				continue
			}

			const tempId = `__temp__${nanoid()}`
			const tempClip: Clip = {
				id: tempId,
				track_id: c.track_id,
				audio_file_id: c.audio_file_id,
				creator_user_id: user.value!.id,
				creator_display_name: user.value!.display_name,
				start_beat: startBeat,
				end_beat: endBeat,
				offset_seconds: c.offset_seconds,
				gain: c.gain,
				muted: c.muted,
				created_at: new Date().toISOString(),
			}

			clips.set(tempId, tempClip)
			selectedClipIds.add(tempId)
			queued++

			socket
				.emitWithAck('get:clip:create', {
					audio_file_id: c.audio_file_id,
					track_id: c.track_id,
					start_beat: startBeat,
					end_beat: endBeat,
					offset_seconds: c.offset_seconds,
					gain: c.gain,
					muted: c.muted,
				})
				.then((res) => {
					if (res.success) {
						clips.delete(tempId)
						selectedClipIds.delete(tempId)
						clips.set(res.data.id, res.data)
						selectedClipIds.add(res.data.id)
					} else {
						userLog('SYSTEM', `Failed to duplicate clip: ${res.error.message}`, {
							textColor: 'red',
						})
						clips.delete(tempId)
						selectedClipIds.delete(tempId)
					}
				})
				.catch(() => {
					clips.delete(tempId)
					selectedClipIds.delete(tempId)
				})
		}

		if (queued === 0) {
			userLog('SYSTEM', 'Nothing duplicated: clips would be outside timeline bounds.', {
				textColor: 'orange',
			})
			return
		}

		const skippedMsg =
			skippedOutOfBounds > 0 ? ` (${skippedOutOfBounds} skipped out of bounds)` : ''
		userLog('SYSTEM', `Duplicated ${queued} clip(s)${skippedMsg}`, { textColor: 'cyan' })
	}

	// --- DELETE ---
	async function deleteSelection() {
		if (selectedClipIds.size === 0) return
		if (user.value?.banned_at) return

		const idsToDelete = [...selectedClipIds]
		selectedClipIds.clear()

		let deleted = 0
		for (const id of idsToDelete) {
			const clip = clips.get(id)
			if (!clip) continue

			// Optimistic delete
			clips.delete(id)
			if (id.startsWith('__temp__')) {
				deleted++
				continue
			}

			socket
				.emitWithAck('get:clip:delete', { id })
				.then((res) => {
					if (!res.success) {
						const message = res.error?.message ?? ''
						if (message.includes('Failed to delete clip')) return

						// Re-add if failed
						if (clip) clips.set(id, clip)
						userLog('SYSTEM', `Failed to delete clip: ${message}`, {
							textColor: 'red',
						})
					}
				})
				.catch(() => {
					if (clip) clips.set(id, clip)
				})

			deleted++
		}

		userLog('SYSTEM', `Deleted ${deleted} clip(s)`, { textColor: 'cyan' })
	}

	// --- Keyboard bindings ---
	if (bindKeyboard) {
		useEventListener(window, 'keydown', (e) => {
			// Don't intercept when typing in inputs
			const tag = (e.target as HTMLElement).tagName
			if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return

			const ctrl = e.ctrlKey || e.metaKey
			const key = e.key.toLowerCase()

			if (ctrl && key === 'c') {
				e.preventDefault()
				copySelection()
				return
			}

			if (ctrl && key === 'v') {
				e.preventDefault()
				pasteClips()
				return
			}

			if (ctrl && key === 'd') {
				e.preventDefault()
				duplicateSelection()
				return
			}

			if (key === 'delete' || key === 'backspace') {
				// Don't delete if focused on an input
				e.preventDefault()
				deleteSelection()
				return
			}
		})
	}

	return { copySelection, pasteClips, duplicateSelection, deleteSelection }
}
