import { defineSocketHandler } from '@/socket/socket'
import { clips, selectedClipIds } from '@/state'
import type { ClipClient } from '~/schema'

export default defineSocketHandler({
	event: 'clip:delete',
	handler: (ids) => {
		for (const id of ids) {
			deleteClipLocally(id)
		}
	},
})

export function deleteClipLocally(clipId: ClipClient['id']) {
	selectedClipIds.delete(clipId)
	clips.delete(clipId)
}
