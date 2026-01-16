import { defineSocketHandler } from '@/socket/socket'
import { user } from '@/state'
import { useConsole } from '@/composables/useConsole'

const { userLog } = useConsole()

export default defineSocketHandler({
	event: 'user:ban_status',
	handler: (data) => {
		// Only act if this event is about the current user
		if (user.value?.id !== data.user_id)
			return userLog('SYSTEM', `@${data.display_name} has been banned.`, {
				textColor: 'gray',
			})

		if (user.value) {
			if (data.is_banned) {
				user.value.banned_at = new Date().toISOString()
				user.value.ban_reason = data.ban_reason

				userLog(
					'SYSTEM',
					`You have been banned. Reason: ${data.ban_reason || 'No reason provided'}`,
					{
						textColor: 'red',
						isBold: true,
					},
				)
			} else {
				user.value.banned_at = null
				user.value.ban_reason = null

				userLog('SYSTEM', `You have been unbanned.`, {
					textColor: 'green',
					isBold: true,
				})
			}
		}
	},
})
