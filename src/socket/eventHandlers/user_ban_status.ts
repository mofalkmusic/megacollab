import { defineSocketHandler } from '@/socket/socket'
import { user } from '@/state'
import { useConsole } from '@/composables/useConsole'

const { userLog } = useConsole()

export default defineSocketHandler({
	event: 'user:ban_status',
	handler: (data) => {
		if (user.value?.id !== data.user_id) {
			if (data.is_banned) {
				return userLog('SYSTEM', `@${data.display_name} has been banned.`, {
					textColor: 'gray',
				})
			} else {
				return userLog('SYSTEM', `@${data.display_name} has been unbanned.`, {
					textColor: 'gray',
				})
			}
		}

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
