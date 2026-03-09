import { defineSocketHandler } from '@/socket/socket'
import { clips, selectedClipIds } from '@/state'
import type { Clip } from '~/schema'

export default defineSocketHandler({
	event: 'clip:delete',
	handler: (id) => {
		delteClipLocally(id)
	},
})

export function delteClipLocally(clipId: Clip['id']) {
	selectedClipIds.delete(clipId)
	clips.delete(clipId)
}
