import { defineSocketHandler } from '@/socket/socket'
import { clips, selectedClipIds } from '@/state'
import type { ClipClient } from '~/schema'

export default defineSocketHandler({
	event: 'clip:delete',
	handler: (id) => {
		delteClipLocally(id)
	},
})

export function delteClipLocally(clipId: ClipClient['id']) {
	selectedClipIds.delete(clipId)
	clips.delete(clipId)
}
