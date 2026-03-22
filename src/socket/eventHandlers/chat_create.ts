import { defineSocketHandler } from '@/socket/socket'
import { chats } from '@/state'
import { useConsole } from '@/composables/useConsole'

const { userLog } = useConsole()

export default defineSocketHandler({
	event: 'chat:create',
	handler: (chatData) => {
		const { id, reply_to_id, text, color, creator_display_name, creator_user_id } = chatData
		chats.set(id, chatData)

		userLog('CHAT', text, {
			textColor: color,
			display_name: creator_display_name,
			user_id: creator_user_id,
			reply_to_id: reply_to_id,
		})
	},
})
