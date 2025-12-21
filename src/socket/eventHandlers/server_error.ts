import { defineSocketHandler } from '@/socket/socket'
import { useRouter } from 'vue-router'

const router = useRouter()

export default defineSocketHandler({
	event: 'server:error',
	handler: (data) => {
		if (data.status === 'UNAUTHORIZED') {
			router.push('/login')
		}

		console.error('server:error emitted:', data)
	},
})
