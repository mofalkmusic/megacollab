import { defineSocketHandler } from '@/socket/socket'
import { audiofiles, clips, otherUserPositions, tracks } from '@/state'

export default defineSocketHandler({
	event: 'user:username_change',
	handler: (data) => {
		updateDisplayNamesForUser(data.user_id, data.new_display_name)
	},
})

export function updateDisplayNamesForUser(userId: string, newDisplayName: string) {
	for (const clip of clips.values()) {
		if (clip.creator_user_id === userId) {
			clip.creator_display_name = newDisplayName
		}
	}

	for (const audioFile of audiofiles.values()) {
		if (audioFile.creator_user_id === userId) {
			audioFile.creator_display_name = newDisplayName
		}
	}

	for (const track of tracks.values()) {
		if (track.belongs_to_user_id === userId) {
			track.belongs_to_display_name = newDisplayName
		}
	}

	const cursorData = otherUserPositions.get(userId)
	if (cursorData) {
		cursorData.display_name = newDisplayName
	}
}
