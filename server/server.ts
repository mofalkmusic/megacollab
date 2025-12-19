import { Hono } from 'hono'
import { getSignedCookie, setSignedCookie } from 'hono/cookie'
import { cors } from 'hono/cors'
import { serveStatic } from 'hono/bun'
import { print, randomSafeHexColor, setupDevelopmentFileHandlerRoutes } from './utils'
import { OAuthStateManager, resolveConnectionUser } from './auth'
import { Server as SocketIOServer } from 'socket.io'
import { Server as BunEngine } from '@socket.io/bun-engine'
import { db } from './database'
import {
	validateIncomingEvents,
	type ClientToServerEvents,
	type ServerToClientEvents,
	type SocketData,
} from './socket'
import { extname, join } from 'path'

import { DEV_FILE_FOLDER, MAX_UPLOAD_FILE_SIZE_BYTES } from './constants'
import { store } from './store'
import { history } from './history'
import { nanoid } from 'nanoid'
import { type AudioFileBase, type Clip, type ServerTrack, type User } from '~/schema'
import { EVENTS } from '~/events'
import { audioMimeTypes, BACKEND_PORT } from '~/constants'
import { sanitizeLetterUnderscoreOnly } from '~/utils'
import z from 'zod'

// const BACKEND_PORT = Bun.env['VITE_APP_DEV_SERVER_PORT'] ?? '5000'
const IN_DEV_MODE = Bun.env['ENV'] === 'development'
const PROD_FOLDER = Bun.env['PROD_FOLDER']
const TWITCH_CLIENT_ID = Bun.env['TWITCH_CLIENT_ID']
const TWITCH_CLIENT_SECRET = Bun.env['TWITCH_CLIENT_SECRET']
const TWITCH_REDIRECT_URI = Bun.env['TWITCH_REDIRECT_URI']
const COOKIE_NAME = 'MEGACOLLAB_SESSION_ID' as const
const COOKIE_SIGNING_SECRET = Bun.env['COOKIE_SIGNING_SECRET']

await db.migrateAndSeedDb()

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
const io = new SocketIOServer<ClientToServerEvents, ServerToClientEvents, {}, SocketData>()
const engine = new BunEngine()

io.bind(engine)

io.on('connection', async (socket) => {
	try {
		const user = await resolveConnectionUser(socket)

		if (!user) {
			socket.emit('server:error', {
				status: 'UNAUTHORIZED',
				message: 'Authentication failed',
			})
			socket.disconnect()
			return
		}

		validateIncomingEvents(socket)

		socket.on('get:ping', (_data, callback) => {
			callback({ success: true, data: null })
		})

		socket.on('get:upload:url', async (data, callback) => {
			const { filename, filesize, filetype } = data

			if (!audioMimeTypes.includes(filetype)) {
				callback({
					success: false,
					error: {
						status: 'BAD_REQUEST',
						message: `Invalid file type: ${filetype}`,
					},
				})
				return
			}

			if (filesize > MAX_UPLOAD_FILE_SIZE_BYTES) {
				callback({
					success: false,
					error: {
						status: 'BAD_REQUEST',
						message: `File too large, max: ${(MAX_UPLOAD_FILE_SIZE_BYTES / 1024 / 1024).toFixed(0)}MB`,
					},
				})
				return
			}

			const fileExt = extname(filename)
			const file_id = nanoid()
			const cleanFileName = sanitizeLetterUnderscoreOnly(filename)

			const folder = IN_DEV_MODE ? '' : `${PROD_FOLDER}/`

			const file_key = `${folder}${cleanFileName}_${user.id}_${file_id}${fileExt}`

			const url = store.getUploadUrl(file_key)

			const color = randomSafeHexColor()

			pendingSocketUploads.set(file_key, {
				user_id: user.id,
				expires_at: Date.now() + 59 * 60 * 1000, // almost 60 min
				file_id,
				file_key,
				file_name: cleanFileName,
				color,
			})

			callback({
				success: true,
				data: { url: url, file_id, file_name: cleanFileName, color, file_key },
			})
		})

		socket.on('get:upload:finalize', async (data, callback) => {
			const { duration, file_key } = data

			const pending = pendingSocketUploads.get(file_key)

			if (!pending || Date.now() > pending.expires_at || pending.user_id !== user.id) {
				return callback({
					success: false,
					error: { status: 'UNAUTHORIZED', message: 'Upload session expired or invalid.' },
				})
			}

			pendingSocketUploads.delete(file_key)

			const result = await store.verifyAudioFile(file_key)

			if (result) {
				callback({
					success: false,
					error: {
						status: 'BAD_REQUEST',
						message: result.error,
						field: String(result.status),
					},
				})
				return
			}

			const publicUrl = store.getPublicUrl(file_key)
			const createdAt = new Date().toISOString()

			const audioFile: AudioFileBase = {
				created_at: createdAt,
				id: pending.file_id,
				creator_user_id: pending.user_id,
				duration,
				file_name: pending.file_name,
				public_url: publicUrl,
				color: pending.color,
			}

			await db.saveAudioFile(audioFile)

			callback({
				success: true,
				data: audioFile,
			})

			socket.broadcast.emit('audiofile:create', audioFile)
		})

		socket.on('get:track:create', async (_, callback) => {
			const newTrack: Omit<ServerTrack, 'order_index'> = {
				id: nanoid(),
				created_at: new Date().toISOString(),
				creator_user_id: user.id,
				title: null,
				belongs_to_user_id: user.id, // for now
				gain_db: 0,
			}

			const track = await db.createTrackSafe(newTrack)

			if (!track) {
				callback({
					success: false,
					error: {
						status: 'SERVER_ERROR',
						message: 'Oops, something unexpected went wrong. Please try reconnecting.',
					},
				})
				return
			}

			callback({
				success: true,
				data: track,
			})

			socket.broadcast.emit('track:create', track)
		})

		socket.on('get:clip:create', async (data, callback) => {
			const { start_beat, end_beat, audio_file_id, track_id } = data

			const newClip: Omit<Clip, 'created_at'> = {
				id: nanoid(),
				creator_user_id: user.id,
				start_beat,
				end_beat,
				audio_file_id,
				gain_db: 0,
				offset_seconds: 0,
				track_id,
			}

			const clip = await db.createClipSafe(newClip)

			if (!clip) {
				callback({
					success: false,
					error: {
						status: 'SERVER_ERROR',
						message: 'Oops, something unexpected went wrong. Please try reconnecting.',
					},
				})
				return
			}

			callback({
				success: true,
				data: clip,
			})

			socket.broadcast.emit('clip:create', clip)

			history.push({
				type: 'CLIP_CREATE',
				payload: clip,
				inverse: { id: clip.id },
				userId: user.id,
			})
		})

		socket.on('get:clip:delete', async (data, callback) => {
			const { id } = data

			const clip = await db.deleteClipSafe(id)

			if (!clip) {
				callback({
					success: false,
					error: {
						status: 'SERVER_ERROR',
						message: 'Oops, something unexpected went wrong. Please try reconnecting.',
					},
				})
				return
			}

			callback({
				success: true,
				data: {
					id: clip.id,
				},
			})

			socket.broadcast.emit('clip:delete', clip)

			history.push({
				type: 'CLIP_DELETE',
				payload: { id: clip.id },
				inverse: clip,
				userId: user.id,
			})
		})

		socket.on('get:clip:update', async (data, callback) => {
			const { id, changes } = data

			const oldClip = await db.getClipSafe(id)

			const clip = await db.updateClipSafe(id, changes)

			if (!clip) {
				callback({
					success: false,
					error: {
						status: 'SERVER_ERROR',
						message: 'Oops, something unexpected went wrong. Please try reconnecting.',
					},
				})
				return
			}

			callback({
				success: true,
				data: clip,
			})

			socket.broadcast.emit('clip:update', clip)

			if (oldClip) {
				const oldValues: any = {}
				for (const key of Object.keys(changes)) {
					oldValues[key] = (oldClip as any)[key]
				}
				history.push({
					type: 'CLIP_UPDATE',
					payload: { id, changes },
					inverse: { id, oldValues },
					userId: user.id,
				})
			}
		})

		socket.on('get:update:username', async (data, callback) => {
			const { username } = data

			const cleanUsername = sanitizeLetterUnderscoreOnly(username, false)

			if (cleanUsername.length < 3) {
				callback({
					success: false,
					error: {
						status: 'BAD_REQUEST',
						message: 'Username must be at least 3 characters long.',
					},
				})
				return
			}

			if (cleanUsername.length > 32) {
				callback({
					success: false,
					error: {
						status: 'BAD_REQUEST',
						message: 'Username must be at most 32 characters long.',
					},
				})
				return
			}

			const updatedUsername = await db.updateExistingUsernameSafe(
				user.id,
				cleanUsername.toLowerCase(),
			)

			if (!updatedUsername) {
				callback({
					success: false,
					error: {
						status: 'SERVER_ERROR',
						message: 'Oops, something unexpected went wrong. Please try again.',
					},
				})
				return
			}

			callback({
				success: true,
				data: {
					username: updatedUsername,
				},
			})

			// todo: when implementing foreign cursors, broadcast this change aswell!
		})

		socket.on('get:undo', async (_, callback) => {
			// todo: dont like the as any, maybe i can find a way to type this differently :D
			// Cast to any required due to TS limitation with correlated generic types in Socket.IO emit
			const result = await history.undo(user.id, (event, data) => io.emit(event as any, data))

			if (result.success) {
				callback({ success: true, data: null })
			} else {
				callback({
					success: false,
					error: {
						status: 'CONFLICT_ERROR',
						message: result.error || 'Undo operation failed due to a conflict.',
					},
				})
			}
		})

		socket.emit('server:ready', {
			user,
			audiofiles: await db.getAudioFilesSafe(),
			clips: await db.getClipsSafe(),
			tracks: await db.getTracksSafe(),
		})

		if (IN_DEV_MODE) esureAllEventsHandled(socket.eventNames())
	} catch (err) {
		print.server(err)
		socket.emit('server:error', {
			status: 'SERVER_ERROR',
			message: 'Oops, something unexpected went wrong. Please try reconnecting.',
		})
		socket.disconnect()
		return
	}
})

// Hono app
const app = new Hono()

app.use(
	'/*',
	cors({
		origin: (origin) => {
			const allowed = [
				'https://mega.mofalk.com',
				'http://localhost:5173',
				'http://127.0.0.1:5173',
				`http://localhost:${BACKEND_PORT}`,
				`http://127.0.0.1:${BACKEND_PORT}`,
			]
			return allowed.includes(origin) ? origin : allowed[0]
		},
		allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
		allowHeaders: ['Content-Type', 'Authorization', 'Upgrade'],
		exposeHeaders: ['Content-Length'],
		maxAge: 600,
		credentials: true,
	}),
	(c, next) => {
		c.header('Cross-Origin-Opener-Policy', 'same-origin')
		c.header('Cross-Origin-Embedder-Policy', 'require-corp')
		return next()
	},
)

if (IN_DEV_MODE) {
	// Ensure dev.audiofiles dir
	const devFilesDir = join(import.meta.dir, '..', DEV_FILE_FOLDER)
	await setupDevelopmentFileHandlerRoutes({ app, devFilesDir })
}

app.get('/api/hello', (c) => c.json({ hello: 'world' }))

app.get('/api/auth/twitch/url', (c) => {
	if (IN_DEV_MODE) {
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

	oAuthStates.set(state, {
		expiresAtMs: Date.now() + 15 * 60 * 1000,
	})

	return c.json({ url: url.toString() }, 200)
})

app.get('/api/auth/verify', async (c) => {
	if (IN_DEV_MODE) return c.text('Authorized', 200)

	const sessionId = await getSignedCookie(c, COOKIE_SIGNING_SECRET, COOKIE_NAME)

	if (!sessionId) {
		return c.text('Unauthorized', 401)
	}

	const user = await db.getUserFromSessionIdSafe(sessionId)

	if (!user) {
		return c.text('Unauthorized', 401)
	}

	return c.text('Authorized', 200)
})

const oAuthStates = new OAuthStateManager()

app.get('/api/auth/twitch/callback', async (c) => {
	if (IN_DEV_MODE) {
		return c.json({ error: 'Dev mode not supported' }, 400)
	}

	const SuccessReqSchema = z.object({
		code: z.string(),
		state: z.string(),
		scope: z.string(),
	})

	const ErrorReqSchema = z.object({
		error: z.string(),
		error_description: z.string(),
		state: z.string(),
	})

	const ReqSchema = z.union([SuccessReqSchema, ErrorReqSchema])

	const result = ReqSchema.safeParse(c.req.query())

	if (!result.success) {
		return c.json({ error: 'Invalid request1', error_description: result.error.message }, 400)
	}

	if ('error' in result.data) {
		// todo: send along the error for user feedback
		return c.redirect('/login')
	}

	const { code, state } = result.data

	const stateData = oAuthStates.get(state)

	if (!stateData) {
		return c.json({ error: 'Invalid state' }, 400)
	}

	if (Date.now() > stateData.expiresAtMs) {
		return c.json({ error: 'State expired' }, 400)
	}

	oAuthStates.delete(state)

	const tokenResponse = await fetch('https://id.twitch.tv/oauth2/token', {
		method: 'POST',
		body: new URLSearchParams({
			client_id: TWITCH_CLIENT_ID || '',
			client_secret: TWITCH_CLIENT_SECRET || '',
			code,
			grant_type: 'authorization_code',
			redirect_uri: TWITCH_REDIRECT_URI || '',
		}),
	})

	const tokenData = await tokenResponse.json()

	const TokenResSchema = z.object({
		access_token: z.string(),
		refresh_token: z.string(),
		scope: z.array(z.string()),
		expires_in: z.number(),
		token_type: z.string(),
	})

	const tokenResult = TokenResSchema.safeParse(tokenData)

	if (!tokenResult.success) {
		console.error(tokenResult.error)
		return c.json({ error: 'Invalid request3', error_description: 'Invalid request' }, 400)
	}

	const { access_token } = tokenResult.data

	const userRes = await fetch('https://api.twitch.tv/helix/users', {
		headers: {
			'Client-Id': TWITCH_CLIENT_ID || '',
			Authorization: `Bearer ${access_token}`,
		},
	})

	if (!userRes.ok) {
		return c.json({ error: 'Invalid request4', error_description: 'Invalid request' }, 400)
	}

	const userResData = await userRes.json()

	const userResSchema = z.object({
		data: z.array(z.object({ id: z.string(), display_name: z.string(), email: z.string() })),
	})

	const userResResult = userResSchema.safeParse(userResData)

	if (!userResResult.success) {
		return c.json({ error: 'Invalid request5', error_description: 'Invalid request' }, 400)
	}

	const { data } = userResResult.data

	if (!data.length) {
		return c.json({ error: 'Invalid request6', error_description: 'Invalid request' }, 400)
	}

	const user = data[0]!

	const newUser: Omit<User, 'created_at'> = {
		id: nanoid(),
		display_name: user.display_name,
		provider: 'twitch',
		provider_email: user.email,
		provider_id: user.id,
		roles: ['regular'],
		color: randomSafeHexColor(),
	}

	const completeUser = await db.makeNewIfNotExistUserSafe(newUser)

	if (!completeUser) {
		// no it was a server error // todo: correct
		return c.json({ error: 'Invalid request7', error_description: 'Invalid request' }, 400)
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
})

app.use('/*', serveStatic({ root: './dist' }))

// - It's not an API route
// - It's not a physical file (like /assets/logo.png)
// So we serve the index.html and let Vue Router handle the URL.
app.get('/*', async (c) => {
	return c.html(await Bun.file('./dist/index.html').text())
})

const { websocket } = engine.handler()

Bun.serve({
	port: Bun.env['PORT'] || BACKEND_PORT,
	idleTimeout: 30,
	fetch(req, server) {
		const url = new URL(req.url)
		if (url.pathname === '/ws/') {
			return engine.handleRequest(req, server)
		}
		return app.fetch(req, server)
	},
	websocket,
})

print.server('Dev server started on port', BACKEND_PORT)

// UTILITIES
// UTILITIES
// UTILITIES
// UTILITIES

type UploadSocketMeta = {
	user_id: string
	file_key: string
	expires_at: number
	file_id: string
	file_name: string
	color: string
}

const pendingSocketUploads = new Map<string, UploadSocketMeta>()

function esureAllEventsHandled(eventNames: (string | symbol)[]) {
	const requiredEvents = [
		...Object.keys(EVENTS.CLIENT_EMITS),
		...Object.keys(EVENTS.CLIENT_REQUESTS),
	]

	const missingEvents = requiredEvents.filter((event) => !eventNames.includes(event))

	if (missingEvents.length > 0) {
		print.server('Missing handlers for events:', missingEvents.join(', '))
	}
}
