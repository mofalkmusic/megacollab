import { createRouter, createWebHistory } from 'vue-router'
import Index from '@/views/Index.vue'
import Login from '@/views/Login.vue'
import isMobile from 'is-mobile'
import NotSupported from '@/views/NotSupported.vue'

const inDev = import.meta.env.MODE === 'development'

declare module 'vue-router' {
	interface RouteMeta {
		auth: 'auth' | 'none' | 'admin'
	}
}

const router = createRouter({
	history: createWebHistory(import.meta.env.BASE_URL),
	routes: [
		{
			path: '/',
			name: 'home',
			component: Index,
			meta: { auth: 'auth' },
		},
		{
			path: '/login',
			name: 'login',
			component: Login,
			meta: { auth: 'none' },
		},
		{
			path: '/not-supported',
			name: 'not-supported',
			component: NotSupported,
			meta: { auth: 'none' },
		},
	],
})

router.beforeEach(async (to, from) => {
	if (inDev) {
		return true
	}

	if (isMobile()) {
		if (to.name !== 'not-supported') {
			return { name: 'not-supported' }
		}
		return true
	} else if (to.name === 'not-supported') {
		return { name: 'home' }
	}

	const res = await fetch('/api/auth/verify', {
		method: 'GET',
		credentials: 'include',
	})

	const isAuthenticated = res.ok

	if ((to.meta.auth === 'auth' || to.meta.auth === 'admin') && !isAuthenticated) {
		return { name: 'login' }
	}

	if (to.name === 'login' && isAuthenticated) {
		return { name: 'home' }
	}

	return true
})

export default router
