import { tracks } from '@/state'
import { defineSocketHandler } from '@/socket/socket'

export default defineSocketHandler({
	event: 'track:update',
	handler: (updatedTrack) => {
		const existing = tracks.get(updatedTrack.id)

		if (!existing) {
			tracks.set(updatedTrack.id, updatedTrack)
			return
		}

		Object.assign(existing, updatedTrack)
	},
})
