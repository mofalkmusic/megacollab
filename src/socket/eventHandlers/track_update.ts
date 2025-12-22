import { tracks } from '@/state'
import { setTrackGain } from '@/audioEngine'
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
		setTrackGain(updatedTrack.id, updatedTrack.gain_db)
	},
})
