import { defineSocketHandler, _socketError } from '@/socket/socket'
import router from '@/router'

export default defineSocketHandler({
	event: 'server:error',
	handler: (data) => {
		if (data.status === 'UNAUTHORIZED') {
			router.push('/login')
		}

		if (data.status === 'RATE_LIMIT_EXCEEDED') {
			_socketError.value = data
		}

		console.error('server:error received:', data)
	},
})
