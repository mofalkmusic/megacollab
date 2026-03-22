import { defineSocketHandler } from '@/socket/socket'
import { audiofiles, clips, otherUserPositions, tracks, chats } from '@/state'
import type { User } from '~/schema'

export default defineSocketHandler({
	event: 'user:update',
	handler: ({ user_id, changes }) => {
		handleUserUpdate(user_id, changes)
	},
})

export function handleUserUpdate(
	userId: User['id'],
	changes: { display_name?: User['display_name']; color?: User['color'] },
) {
	if (changes.display_name !== undefined) {
		for (const clip of clips.values()) {
			if (clip.creator_user_id === userId) {
				clip.creator_display_name = changes.display_name
			}
		}

		for (const audioFile of audiofiles.values()) {
			if (audioFile.creator_user_id === userId) {
				audioFile.creator_display_name = changes.display_name
			}
		}

		for (const track of tracks.values()) {
			if (track.belongs_to_user_id === userId) {
				track.belongs_to_display_name = changes.display_name
			}
		}

		for (const chat of chats.values()) {
			if (chat.creator_user_id === userId) {
				chat.creator_display_name = changes.display_name
			}
		}

		const cursorData = otherUserPositions.get(userId)
		if (cursorData) {
			cursorData.display_name = changes.display_name
		}
	}

	if (changes.color !== undefined) {
		for (const chat of chats.values()) {
			if (chat.creator_user_id === userId) {
				chat.color = changes.color
			}
		}
	}
}
