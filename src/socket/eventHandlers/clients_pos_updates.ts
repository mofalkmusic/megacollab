import { otherUserPositions, user } from '@/state'
import { defineSocketHandler } from '@/socket/socket'

export default defineSocketHandler({
	event: 'clients:pos_updates',
	handler: (data) => {
		const activeUserIds = new Set<string>()

		for (const [userId, packet] of Object.entries(data)) {
			// ignore self
			if (user.value && userId === user.value.id) continue

			otherUserPositions.set(userId, {
				pos: packet.pos,
				display_name: packet.display_name,
				color: packet.color,
				lastUpdated: packet.updatedAt,
			})

			activeUserIds.add(userId)
		}

		// todo: this could run modulo every 4th run or so... idk
		for (const userId of otherUserPositions.keys()) {
			if (!activeUserIds.has(userId)) {
				otherUserPositions.delete(userId)
			}
		}
	},
})
