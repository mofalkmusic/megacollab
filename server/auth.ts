import { getSignedCookie } from 'hono/cookie'
import { db } from './database'
import type { Socket } from 'socket.io'
import type { User } from '~/schema'

const COOKIE_NAME = 'MEGACOLLAB_SESSION_ID' as const
const COOKIE_SIGNING_SECRET = Bun.env['COOKIE_SIGNING_SECRET']
const IN_DEV_MODE = Bun.env['ENV'] === 'development'

export async function resolveConnectionUser(socket: Socket): Promise<User | null> {
	const cookieHeader = socket.handshake.headers['cookie']

	if (cookieHeader) {
		const tempReq = new Request(socket.handshake.url, {
			headers: { cookie: cookieHeader },
		})

		// @ts-expect-error Hono cookie helper expects Hono Context but works with { req: { raw: Request } } structure for basic reading
		const sessionId = await getSignedCookie(
			{ req: { raw: tempReq } },
			COOKIE_SIGNING_SECRET,
			COOKIE_NAME,
		)

		if (sessionId) {
			const user = await db.getUserFromSessionIdSafe(sessionId)
			if (user) return user
		}
	}

	if (IN_DEV_MODE) {
		return await db.getOrCreateDevUser()
	}

	return null
}

export class OAuthStateManager {
	private states = new Map<string, { expiresAtMs: number }>()
	private interval: ReturnType<typeof setInterval> | null = null

	set(state: string, data: { expiresAtMs: number }) {
		this.states.set(state, data)
		this.startCleanup()
	}

	get(state: string) {
		return this.states.get(state)
	}

	delete(state: string) {
		const result = this.states.delete(state)
		if (this.states.size === 0) {
			this.stopCleanup()
		}
		return result
	}

	private startCleanup() {
		if (this.interval) return

		this.interval = setInterval(
			() => {
				const now = Date.now()
				for (const [key, value] of this.states) {
					if (now > value.expiresAtMs) {
						this.states.delete(key)
					}
				}

				if (this.states.size === 0) {
					this.stopCleanup()
				}
			},
			2 * 60 * 1000,
		)
	}

	private stopCleanup() {
		if (this.interval) {
			clearInterval(this.interval)
			this.interval = null
		}
	}
}
