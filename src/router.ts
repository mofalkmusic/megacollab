import { createRouter, createWebHistory } from 'vue-router'
import Index from '@/views/Index.vue'

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
			component: () => import('@/views/Login.vue'),
			meta: { auth: 'none' },
		},
	],
})

router.beforeEach(async (to, from, next) => {
	return next()
	const res = await fetch('/api/auth/verify', {
		method: 'GET',
		credentials: 'include',
	})

	let isAuthenticated: boolean = false

	if (res.ok) {
		isAuthenticated = true
	}

	if ((to.meta.auth === 'auth' || to.meta.auth === 'admin') && !isAuthenticated) {
		return next({ name: 'login' })
	}

	if (to.name === 'login' && isAuthenticated) {
		return next({ name: 'home' })
	}

	return next()
})

export default router
