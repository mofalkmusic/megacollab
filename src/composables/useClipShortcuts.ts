import { useEventListener } from '@vueuse/core'
import { clipboardClips, clips, selectedClipIds, TOTAL_BEATS, user } from '@/state'
import { currentPlayTimeBeats } from '@/audioEngine'
import { nanoid } from 'nanoid'
import { socket } from '@/socket/socket'
import type { ClipClient } from '~/schema'
import { deleteClipLocally } from '@/socket/eventHandlers/clip_delete'
import { useConsole } from '@/composables/useConsole'
import { menuShortcutsActive } from '@/composables/useMenuShortcutLock'
import { controlKeyPressed } from '@/utils/globalHotKeys'

export function useClipShortcuts() {
	const { userLog } = useConsole()

	useEventListener('keydown', async (event: KeyboardEvent) => {
		const target = event.target
		if (
			target instanceof HTMLElement &&
			(target.tagName === 'INPUT' ||
				target.tagName === 'TEXTAREA' ||
				target.isContentEditable)
		) {
			return
		}

		if (menuShortcutsActive.value) return

		const currentUser = user.value
		if (!currentUser) return

		if (controlKeyPressed.value && event.key.toLowerCase() === 'c') {
			event.preventDefault()
			const selected = Array.from(selectedClipIds)
				.map((id) => clips.get(id))
				.filter((clip): clip is ClipClient => clip !== undefined)
			if (selected.length > 0) {
				clipboardClips.value = JSON.parse(JSON.stringify(selected))
			}
			return
		}

		if (controlKeyPressed.value && event.key.toLowerCase() === 'x') {
			event.preventDefault()
			const selected = Array.from(selectedClipIds)
				.map((id) => clips.get(id))
				.filter((clip): clip is ClipClient => clip !== undefined)

			if (selected.length === 0) return

			clipboardClips.value = JSON.parse(JSON.stringify(selected))

			const idsToDelete = selected.map((c) => c.id)
			const snapshot = new Map<string, ClipClient>()
			for (const id of idsToDelete) {
				const c = clips.get(id)
				if (c) {
					snapshot.set(id, { ...c })
					deleteClipLocally(id)
				}
			}

			try {
				const res = await socket.emitWithAck('get:clip:delete', idsToDelete)
				if (!res.success) {
					throw new Error(res.error.message)
				}
			} catch (e) {
				userLog('SYSTEM', `Cut failed: ${e instanceof Error ? e.message : String(e)}`, {
					textColor: 'red',
				})
				for (const [id, clip] of snapshot.entries()) {
					clips.set(id, clip)
				}
			}
			return
		}

		if (controlKeyPressed.value && event.key.toLowerCase() === 'v') {
			event.preventDefault()
			if (clipboardClips.value.length === 0) return

			const earliestBeat = Math.min(...clipboardClips.value.map((c) => c.start_beat))
			const targetBeat = currentPlayTimeBeats.value

			const newClips: ClipClient[] = clipboardClips.value.map((clip) => {
				const shift = targetBeat - earliestBeat
				return {
					...clip,
					id: `__temp__${nanoid()}`,
					start_beat: clip.start_beat + shift,
					end_beat: clip.end_beat + shift,
					created_at: new Date().toISOString(),
					creator_user_id: currentUser.id,
					creator_display_name: currentUser.display_name,
				}
			})

			await insertOptimisticClips(newClips, userLog)
			return
		}

		if (
			controlKeyPressed.value &&
			(event.key.toLowerCase() === 'd' || event.key.toLowerCase() === 'b')
		) {
			event.preventDefault()
			const selected = Array.from(selectedClipIds)
				.map((id) => clips.get(id))
				.filter((clip): clip is ClipClient => clip !== undefined)
			if (selected.length === 0) return

			const earliestStart = Math.min(...selected.map((c) => c.start_beat))
			const latestEnd = Math.max(...selected.map((c) => c.end_beat))
			const offset = latestEnd - earliestStart

			const newClips: ClipClient[] = selected.map((clip) => {
				return {
					...JSON.parse(JSON.stringify(clip)),
					id: `__temp__${nanoid()}`,
					start_beat: clip.start_beat + offset,
					end_beat: clip.end_beat + offset,
					created_at: new Date().toISOString(),
					creator_user_id: currentUser.id,
					creator_display_name: currentUser.display_name,
				}
			})

			await insertOptimisticClips(newClips, userLog)
			return
		}

		if (event.key === 'Backspace' || event.key === 'Delete') {
			if (selectedClipIds.size === 0) return
			event.preventDefault()

			const idsToDelete = Array.from(selectedClipIds)
			if (idsToDelete.length === 0) return

			const snapshot = new Map<string, ClipClient>()
			for (const id of idsToDelete) {
				const c = clips.get(id)
				if (c) {
					snapshot.set(id, { ...c })
					deleteClipLocally(id)
				}
			}

			try {
				const res = await socket.emitWithAck('get:clip:delete', idsToDelete)
				if (!res.success) {
					throw new Error(res.error.message)
				}
			} catch (e) {
				userLog('SYSTEM', `Delete failed: ${e instanceof Error ? e.message : String(e)}`, {
					textColor: 'red',
				})
				for (const [id, clip] of snapshot.entries()) {
					clips.set(id, clip)
				}
			}
			return
		}
	})
}

async function insertOptimisticClips(newClips: ClipClient[], userLog: any) {
	for (const clip of newClips) {
		if (clip.end_beat > TOTAL_BEATS || clip.start_beat < 0) {
			userLog('SYSTEM', 'Not enough space on the timeline to perform this action!', {
				textColor: 'orange',
			})
			return
		}
	}

	const tempIds = newClips.map((c) => c.id)

	selectedClipIds.clear()
	for (const clip of newClips) {
		clips.set(clip.id, clip)
		selectedClipIds.add(clip.id)
	}

	const reqBody = newClips.map((c) => ({
		start_beat: c.start_beat,
		end_beat: c.end_beat,
		audio_file_id: c.audio_file_id,
		track_id: c.track_id,
		offset_seconds: c.offset_seconds,
		gain: c.gain,
		fade_in_sec: c.fade_in_sec,
		fade_out_sec: c.fade_out_sec,
		is_muted: c.is_muted,
	}))

	try {
		const syncRes = await socket.emitWithAck('get:clip:create', reqBody)
		if (syncRes.success) {
			for (const id of tempIds) {
				clips.delete(id)
				selectedClipIds.delete(id)
			}
			for (const clip of syncRes.data) {
				clips.set(clip.id, clip)
				selectedClipIds.add(clip.id)
			}
		} else {
			throw new Error(syncRes.error.message)
		}
	} catch (e) {
		userLog('SYSTEM', `Creation failed: ${e instanceof Error ? e.message : String(e)}`, {
			textColor: 'red',
		})
		for (const id of tempIds) {
			clips.delete(id)
		}
	}
}
