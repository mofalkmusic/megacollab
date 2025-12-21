import { defineSocketHandler } from '@/socket/socket'
import { clips } from '@/state'

export default defineSocketHandler({
	event: 'clip:delete',
	handler: (id) => {
		clips.delete(id)
	},
})
