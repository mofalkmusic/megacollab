import { defineSocketHandler } from '@/socket/socket'
import router from '@/router'

export default defineSocketHandler({
	event: 'server:error',
	handler: (data) => {
		if (data.status === 'UNAUTHORIZED') {
			router.push('/login')
		}

		console.error('server:error emitted:', data)
	},
})
