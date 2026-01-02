import { getSignedCookie, setSignedCookie } from 'hono/cookie'
import { db } from './database'
import type { Socket } from 'socket.io'
import type { User } from '~/schema'
import type { Context } from 'hono'
import z from 'zod'
import { nanoid } from 'nanoid'
import { randomSafeHexColor } from './utils'
import { sanitizeLetterUnderscoreOnly } from '~/utils'

const IN_DEV_MODE = Bun.env['ENV'] === 'development'
const ALLOW_AUTH_IN_DEV_MODE = false

export const COOKIE_NAME = 'MEGACOLLAB_SESSION_ID' as const

export const COOKIE_SIGNING_SECRET =
	Bun.env['COOKIE_SIGNING_SECRET'] || (IN_DEV_MODE ? 'default_dev' : undefined)

if (!COOKIE_SIGNING_SECRET) {
	throw new Error('COOKIE_SIGNING_SECRET is not set')
}

const DISCORD_CLIENT_ID = Bun.env['DISCORD_CLIENT_ID']
const DISCORD_CLIENT_SECRET = Bun.env['DISCORD_CLIENT_SECRET']
const DISCORD_REDIRECT_URI = Bun.env['DISCORD_REDIRECT_URI']
const TWITCH_CLIENT_ID = Bun.env['TWITCH_CLIENT_ID']
const TWITCH_CLIENT_SECRET = Bun.env['TWITCH_CLIENT_SECRET']
const TWITCH_REDIRECT_URI = Bun.env['TWITCH_REDIRECT_URI']

export async function resolveConnectionUser(socket: Socket): Promise<User | null> {
	const cookieHeader = socket.handshake.headers['cookie']

	if (cookieHeader) {
		const tempReq = new Request(socket.handshake.url, {
			headers: { cookie: cookieHeader },
		})

		const sessionId = await getSignedCookie(
			// @ts-expect-error Hono cookie helper expects Hono Context but works with { req: { raw: Request } } structure for basic reading
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

	set(state: string) {
		this.states.set(state, { expiresAtMs: Date.now() + 15 * 60 * 1000 })
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

export const oAuthStates = new OAuthStateManager()

export async function getSignOut(c: Context) {
	if (IN_DEV_MODE && !ALLOW_AUTH_IN_DEV_MODE) {
		return c.json({ error: 'Dev mode not supported' }, 400)
	}

	const sessionId = await getSignedCookie(c, COOKIE_SIGNING_SECRET, COOKIE_NAME)

	if (!sessionId) {
		const params = new URLSearchParams({
			success: "You've been signed out.",
		})
		return c.redirect(`/login?${params.toString()}`, 302)
	}

	await setSignedCookie(c, COOKIE_NAME, '', COOKIE_SIGNING_SECRET, {
		httpOnly: true,
		secure: !IN_DEV_MODE,
		maxAge: 0,
		sameSite: 'lax',
	})

	await db.deleteSessionSafe(sessionId)

	const params = new URLSearchParams({
		success: "You've been successfully signed out.",
	})

	return c.redirect(`/login?${params.toString()}`, 302)
}

export function getTwitchOAuthUrl(c: Context) {
	if (IN_DEV_MODE && !ALLOW_AUTH_IN_DEV_MODE) {
		return c.json({ error: 'Dev mode not supported' }, 400)
	}

	const state = nanoid()
	const scope = 'user:read:email'

	const url = new URL('https://id.twitch.tv/oauth2/authorize')
	url.searchParams.set('client_id', TWITCH_CLIENT_ID || '')
	url.searchParams.set('redirect_uri', TWITCH_REDIRECT_URI || '')
	url.searchParams.set('response_type', 'code')
	url.searchParams.set('scope', scope)
	url.searchParams.set('state', state)

	oAuthStates.set(state)

	return c.json({ url: url.toString() }, 200)
}

export function getDiscordOAuthUrl(c: Context) {
	if (IN_DEV_MODE && !ALLOW_AUTH_IN_DEV_MODE) {
		return c.json({ error: 'Dev mode not supported' }, 400)
	}

	const state = nanoid()
	const scope = 'identify email'

	const url = new URL('https://discord.com/oauth2/authorize')
	url.searchParams.set('client_id', DISCORD_CLIENT_ID || '')
	url.searchParams.set('redirect_uri', DISCORD_REDIRECT_URI || '')
	url.searchParams.set('response_type', 'code')
	url.searchParams.set('scope', scope)
	url.searchParams.set('state', state)
	url.searchParams.set('prompt', 'none')

	oAuthStates.set(state)

	return c.json({ url: url.toString() }, 200)
}

export async function handleTwitchOAuthCallback(c: Context) {
	if (IN_DEV_MODE && !ALLOW_AUTH_IN_DEV_MODE) {
		return c.json({ error: 'Dev mode not supported' }, 400)
	}

	try {
		const result = TwitchCallbackReqSchema.safeParse(c.req.query())

		if (!result.success) {
			const params = new URLSearchParams({
				error: 'invalid_request',
				error_description: 'Invalid request',
			})
			return c.redirect(`/login?${params.toString()}`, 302)
		}

		if ('error' in result.data) {
			const { error, error_description } = result.data
			const params = new URLSearchParams({ error, error_description })
			return c.redirect(`/login?${params.toString()}`, 302)
		}

		const { code, state } = result.data

		const stateData = oAuthStates.get(state)

		if (!stateData) {
			const params = new URLSearchParams({
				error: 'invalid_state',
				error_description: 'Invalid state. Please try again.',
			})
			return c.redirect(`/login?${params.toString()}`, 302)
		}

		if (Date.now() > stateData.expiresAtMs) {
			const params = new URLSearchParams({
				error: 'state_expired',
				error_description: 'State expired. Please try again.',
			})
			return c.redirect(`/login?${params.toString()}`, 302)
		}

		oAuthStates.delete(state)

		const tokenResponse = await fetch('https://id.twitch.tv/oauth2/token', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
			},
			body: new URLSearchParams({
				client_id: TWITCH_CLIENT_ID || '',
				client_secret: TWITCH_CLIENT_SECRET || '',
				code,
				grant_type: 'authorization_code',
				redirect_uri: TWITCH_REDIRECT_URI || '',
			}),
		})

		const TokenSchema = z.union([TwitchTokenResSchema, OAuthTokenErrorSchema])

		let tokenData: z.output<typeof TokenSchema>

		try {
			tokenData = TokenSchema.parse(await tokenResponse.json())
		} catch (err) {
			const params = new URLSearchParams({
				error: 'token_request_failed',
				error_description: 'Failed to request token. Please try again.',
			})
			return c.redirect(`/login?${params.toString()}`, 302)
		}

		if ('error' in tokenData) {
			const params = new URLSearchParams({
				error: tokenData.error,
				error_description:
					tokenData.error_description || 'Failed to request token. Please try again.',
			})
			return c.redirect(`/login?${params.toString()}`, 302)
		}

		const { access_token } = tokenData

		const userRes = await fetch('https://api.twitch.tv/helix/users', {
			headers: {
				'Client-Id': TWITCH_CLIENT_ID || '',
				Authorization: `Bearer ${access_token}`,
			},
		})

		const userResSchema = z.object({
			data: z.array(z.object({ id: z.string(), display_name: z.string(), email: z.string() })),
		})

		let userData: z.output<typeof userResSchema>

		try {
			userData = userResSchema.parse(await userRes.json())
		} catch (err) {
			const params = new URLSearchParams({
				error: 'user_request_failed',
				error_description: 'Failed to request user. Please try again.',
			})
			return c.redirect(`/login?${params.toString()}`, 302)
		}

		const { data } = userData

		if (!data.length) {
			const params = new URLSearchParams({
				error: 'user_request_failed',
				error_description: 'No user data found. Please try again.',
			})
			return c.redirect(`/login?${params.toString()}`, 302)
		}

		const user = data[0]!

		const newUser: Omit<User, 'created_at'> = {
			id: nanoid(),
			display_name: sanitizeLetterUnderscoreOnly(user.display_name),
			provider: 'twitch',
			provider_email: user.email,
			provider_id: user.id,
			roles: ['regular'],
			color: randomSafeHexColor(),
		}

		const completeUser = await db.makeNewIfNotExistUserSafe(newUser)

		if (!completeUser) {
			const params = new URLSearchParams({
				error: 'user_creation_failed',
				error_description: 'Failed to create user. Please try again.',
			})
			return c.redirect(`/login?${params.toString()}`, 302)
		}

		const sessionId = nanoid(64)

		await db.saveSessionSafe({ session_id: sessionId, user_id: completeUser.id })

		await setSignedCookie(c, COOKIE_NAME, sessionId, COOKIE_SIGNING_SECRET, {
			httpOnly: true,
			secure: !IN_DEV_MODE,
			maxAge: 60 * 60 * 24 * 7,
			sameSite: 'lax',
		})

		return c.redirect('/')
	} catch (err) {
		const params = new URLSearchParams({
			error: 'internal_server_error',
			error_description: 'An internal server error occurred. Please try again later.',
		})
		return c.redirect(`/login?${params.toString()}`, 302)
	}
}

export async function handleDiscordOAuthCallback(c: Context) {
	if (IN_DEV_MODE && !ALLOW_AUTH_IN_DEV_MODE) {
		return c.text('Dev mode not supported', 400)
	}

	try {
		const result = DiscordCallbackReqSchema.safeParse(c.req.query())

		if (!result.success) {
			const params = new URLSearchParams({
				error: 'invalid_request',
				error_description: 'Invalid request',
			})
			return c.redirect(`/login?${params.toString()}`, 302)
		}

		if ('error' in result.data) {
			const { error, error_description } = result.data
			const params = new URLSearchParams({ error, error_description })
			return c.redirect(`/login?${params.toString()}`, 302)
		}

		const { code, state } = result.data
		const stateData = oAuthStates.get(state)

		if (!stateData) {
			const params = new URLSearchParams({
				error: 'invalid_state',
				error_description: 'Invalid state. Please try again.',
			})
			return c.redirect(`/login?${params.toString()}`, 302)
		}

		if (Date.now() > stateData.expiresAtMs) {
			const params = new URLSearchParams({
				error: 'state_expired',
				error_description: 'State expired. Please try again.',
			})
			return c.redirect(`/login?${params.toString()}`, 302)
		}

		oAuthStates.delete(state)

		const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
			},
			body: new URLSearchParams({
				client_id: DISCORD_CLIENT_ID || '',
				client_secret: DISCORD_CLIENT_SECRET || '',
				code,
				grant_type: 'authorization_code',
				redirect_uri: DISCORD_REDIRECT_URI || '',
			}),
		})

		const TokenSchema = z.union([DiscordTokenResSchema, OAuthTokenErrorSchema])

		let tokenData: z.output<typeof TokenSchema>

		try {
			tokenData = TokenSchema.parse(await tokenResponse.json())
		} catch (err) {
			const params = new URLSearchParams({
				error: 'token_request_failed',
				error_description: 'Failed to request token. Please try again.',
			})
			return c.redirect(`/login?${params.toString()}`, 302)
		}

		if ('error' in tokenData) {
			const params = new URLSearchParams({
				error: tokenData.error,
				error_description:
					tokenData.error_description || 'Failed to request token. Please try again.',
			})
			return c.redirect(`/login?${params.toString()}`, 302)
		}

		const { access_token } = tokenData

		const userRes = await fetch('https://discord.com/api/v10/users/@me', {
			headers: {
				Authorization: `Bearer ${access_token}`,
			},
		})

		const userResSchema = z.object({
			id: z.string(),
			username: z.string(),
			email: z.string(),
		})

		let userData: z.output<typeof userResSchema>

		try {
			userData = userResSchema.parse(await userRes.json())
		} catch (err) {
			const params = new URLSearchParams({
				error: 'user_request_failed',
				error_description: 'Failed to request user. Please try again.',
			})
			return c.redirect(`/login?${params.toString()}`, 302)
		}

		const newUser: Omit<User, 'created_at'> = {
			id: nanoid(),
			display_name: sanitizeLetterUnderscoreOnly(userData.username),
			provider: 'discord',
			provider_email: userData.email,
			provider_id: userData.id,
			roles: ['regular'],
			color: randomSafeHexColor(),
		}

		const completeUser = await db.makeNewIfNotExistUserSafe(newUser)

		if (!completeUser) {
			const params = new URLSearchParams({
				error: 'user_creation_failed',
				error_description: 'Failed to create user. Please try again.',
			})
			return c.redirect(`/login?${params.toString()}`, 302)
		}

		const sessionId = nanoid(64)

		await db.saveSessionSafe({ session_id: sessionId, user_id: completeUser.id })

		await setSignedCookie(c, COOKIE_NAME, sessionId, COOKIE_SIGNING_SECRET, {
			httpOnly: true,
			secure: !IN_DEV_MODE,
			maxAge: 60 * 60 * 24 * 7,
			sameSite: 'lax',
		})

		return c.redirect('/')
	} catch (err) {
		const params = new URLSearchParams({
			error: 'internal_server_error',
			error_description: 'An internal server error occurred. Please try again later.',
		})
		return c.redirect(`/login?${params.toString()}`, 302)
	}
}

const TwitchSuccessReqSchema = z.object({
	code: z.string(),
	state: z.string(),
	scope: z.string(),
})

const TwitchErrorReqSchema = z.object({
	error: z.string(),
	error_description: z.string(),
	state: z.string(),
})

const TwitchCallbackReqSchema = z.union([TwitchSuccessReqSchema, TwitchErrorReqSchema])

const DiscordSuccessReqSchema = z.object({
	code: z.string(),
	state: z.string(),
})

const DiscordErrorReqSchema = z.object({
	error: z.string(),
	error_description: z.string(),
	state: z.string().optional(), // state should be echoed if you sent it, but make it optional to be defensive
})

const DiscordCallbackReqSchema = z.union([DiscordSuccessReqSchema, DiscordErrorReqSchema])

const OAuthTokenErrorSchema = z.object({
	error: z.string(),
	error_description: z.string().optional(),
	error_uri: z.string().optional(),
})

const BaseTokenResSchema = z.object({
	access_token: z.string(),
	refresh_token: z.string(),
	expires_in: z.number(),
	token_type: z.string(),
})

const TwitchTokenResSchema = BaseTokenResSchema.extend({
	scope: z.array(z.string()),
})

const DiscordTokenResSchema = BaseTokenResSchema.extend({
	scope: z.string(),
})
