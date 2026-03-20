import { defineSocketHandler } from '@/socket/socket'
import { clips } from '@/state'

export default defineSocketHandler({
	event: 'clip:create',
	handler: (data) => {
		for (const clipData of data) {
			const existing = clips.get(clipData.id)

			if (existing) {
				clips.set(clipData.id, {
					...existing,
					...clipData,
				})
			} else {
				clips.set(clipData.id, clipData)
			}
		}
	},
})
