import { defineSocketHandler } from '@/socket/socket'
import { clips, selectedClipIds } from '@/state'

export default defineSocketHandler({
	event: 'clip:delete',
	handler: (id) => {
		clips.delete(id)
		selectedClipIds.delete(id)
	},
})
