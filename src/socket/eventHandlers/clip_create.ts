import { defineSocketHandler } from '@/socket/socket'
import { clips } from '@/state'

export default defineSocketHandler({
	event: 'clip:create',
	handler: (data) => {
		const existing = clips.get(data.id)

		if (existing) {
			clips.set(data.id, {
				...existing,
				...data,
			})

			return
		}

		clips.set(data.id, data)
	},
})
