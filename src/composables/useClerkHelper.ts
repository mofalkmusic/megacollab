import { useAuth } from '@clerk/vue'
import { watch } from 'vue'

const _template = 'megacollab_session' as const

export default function useClerkHelper() {
	function ensureLoaded(): Promise<ReturnType<typeof useAuth>> {
		const auth = useAuth()

		return new Promise((res) => {
			if (auth.isLoaded.value) return res(auth)

			const { stop } = watch(auth.isLoaded, (loaded) => {
				if (!loaded) return

				stop()
				res(auth)
			})
		})
	}

	async function getAuthToken() {
		const auth = await ensureLoaded()
		return await auth.getToken.value({ template: _template })
	}

	async function getUserId() {
		const auth = await ensureLoaded()
		return auth.userId.value
	}

	async function signOutUser() {
		const auth = await ensureLoaded()
		await auth.signOut.value({ redirectUrl: '/login' })
	}

	return {
		getUserId,
		getAuthToken,
		signOutUser,
	}
}
