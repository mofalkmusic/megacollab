import { clips, tracks } from '@/state'
import { unregisterTrack } from '@/audioEngine'
import { defineSocketHandler } from '@/socket/socket'

export default defineSocketHandler({
	event: 'track:delete',
	handler: ({ track_id, deleted_clips }) => {
		const existing = tracks.get(track_id)
		if (!existing) return

		deleted_clips.forEach((id) => {
			clips.delete(id)
		})

		unregisterTrack(track_id)
		tracks.delete(track_id)
	},
})
