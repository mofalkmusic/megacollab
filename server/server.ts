import { Hono } from 'hono'
import { getSignedCookie } from 'hono/cookie'
import { cors } from 'hono/cors'
import { serveStatic } from 'hono/bun'
import {
	print,
	randomSafeHexColor,
	setupDevelopmentFileHandlerRoutes,
	generateStorageKey,
} from './utils'
import {
	COOKIE_NAME,
	getDiscordOAuthUrl,
	getTwitchOAuthUrl,
	handleDiscordOAuthCallback,
	handleTwitchOAuthCallback,
	resolveConnectionUser,
	COOKIE_SIGNING_SECRET,
	getSignOut,
} from './auth'
import { Server as SocketIOServer } from 'socket.io'
import { Server as BunEngine } from '@socket.io/bun-engine'
import { db } from './database'
import {
	validateIncomingEvents,
	type ClientToServerEvents,
	type ServerToClientEvents,
	type SocketData,
} from './socket'
import { join } from 'path'
import { DEV_FILE_FOLDER, MAX_UPLOAD_FILE_SIZE_BYTES } from './constants'
import { store } from './store'
import { history } from './history'
import { nanoid } from 'nanoid'
import {
	type ClientTrack,
	type Clip,
	type ServerTrack,
	type ClientAudioFile,
	type TimelinePos,
} from '~/schema'
import { EVENTS } from '~/events'
import { audioMimeTypes, BACKEND_PORT, CURSOR_INACTIVE_TIMEOUT_MS, DEFAULT_GAIN } from '~/constants'
import { sanitizeLetterUnderscoreOnly } from '~/utils'
import { RateLimiter, getSafeIp } from './ratelimiter'

const IN_DEV_MODE = Bun.env['ENV'] === 'development'

await db.migrateAndSeedDb()

// CURSOR TRACKING
const userPositions = new Map<
	string,
	{ pos: TimelinePos; display_name: string; updatedAt: number }
>()

// send positions to clients every 100ms
let lastUpdateHadData = false
setInterval(() => {
	const now = Date.now()
	const payload: Record<string, { pos: TimelinePos; display_name: string; updatedAt: number }> =
		{}

	for (const [userId, data] of userPositions.entries()) {
		if (now - data.updatedAt > CURSOR_INACTIVE_TIMEOUT_MS) {
			userPositions.delete(userId)
			continue
		}
		payload[userId] = data
	}

	const hasData = Object.keys(payload).length > 0

	if (!hasData && !lastUpdateHadData) return

	io.emit('clients:pos_updates', payload)
	lastUpdateHadData = hasData
}, 100)

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
const io = new SocketIOServer<ClientToServerEvents, ServerToClientEvents, {}, SocketData>()

const engine = new BunEngine()
io.bind(engine)

io.on('connection', async (socket) => {
	try {
		if (socket.request.headers['x-mega-internal-is-rate-limited'] === 'true') {
			socket.emit('server:error', {
				status: 'RATE_LIMIT_EXCEEDED',
				tryAgainAtMs: Number(socket.request.headers['x-mega-internal-rate-limit-reset']),
				message: 'Rate limit exceeded',
			})
			socket.disconnect()
			return
		}

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

		socket.on('disconnect', () => {
			if (userPositions.has(user.id)) {
				userPositions.delete(user.id)
			}
		})

		socket.on('emit:updatepos', (pos) => {
			userPositions.set(user.id, {
				pos,
				display_name: user.display_name,
				updatedAt: Date.now(),
			})
		})

		socket.on('emit:clearpos', () => {
			userPositions.delete(user.id)
		})

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

			const file_id = nanoid()
			const cleanFileName = sanitizeLetterUnderscoreOnly(filename)

			const file_key = generateStorageKey(cleanFileName, user.id, file_id)

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
					error: {
						status: 'UNAUTHORIZED',
						message: 'Upload session expired or invalid.',
					},
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

			const audioFile: ClientAudioFile = {
				created_at: createdAt,
				id: pending.file_id,
				creator_user_id: pending.user_id,
				creator_display_name: user.display_name,
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

		socket.on('get:track:delete', async (data, callback) => {
			const { id } = data

			// todo: check authorization (creator or belongs_to_user_id)

			try {
				const result = await db.deleteTrack(id)
				const { deleted_clips, deleted_track } = result

				callback({
					success: true,
					data: {
						track_id: deleted_track.id,
						deleted_clips,
					},
				})

				socket.broadcast.emit('track:delete', {
					track_id: deleted_track.id,
					deleted_clips,
				})
			} catch (err) {
				const error = err instanceof Error ? err.message : 'Unknown error'
				callback({
					success: false,
					error: {
						status: 'SERVER_ERROR',
						message: `Database error: ${error}`,
					},
				})
			}
		})

		socket.on('get:track:create', async (_, callback) => {
			const newTrack: Omit<ServerTrack, 'order_index'> = {
				id: nanoid(),
				created_at: new Date().toISOString(),
				creator_user_id: user.id,
				title: null,
				belongs_to_user_id: user.id, // for now
				gain: DEFAULT_GAIN,
			}

			let track: ClientTrack

			try {
				track = await db.createTrack(newTrack)
			} catch (err) {
				const error = err instanceof Error ? err.message : 'Unknown error'

				callback({
					success: false,
					error: {
						status: 'SERVER_ERROR',
						message: `Database error: ${error}`,
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

		socket.on('get:track:update', async (data, callback) => {
			const { id, changes } = data

			// todo: add volume changes to history for undos

			// const t = await db.getTrackSafe(id)

			// if (!t || (t.belongs_to_user_id !== user.id && t.belongs_to_user_id != null)) {
			// 	callback({
			// 		success: false,
			// 		error: {
			// 			status: 'UNAUTHORIZED',
			// 			message: 'You are not authorized to update this track.',
			// 		},
			// 	})
			// 	return
			// }

			try {
				const track = await db.updateTrack(id, changes)

				callback({
					success: true,
					data: track,
				})

				socket.broadcast.emit('track:update', track)
			} catch (err) {
				const error = err instanceof Error ? err.message : 'Unknown error'
				callback({
					success: false,
					error: {
						status: 'SERVER_ERROR',
						message: `Database error: ${error}`,
					},
				})
			}
		})

		socket.on('get:clip:create', async (data, callback) => {
			const { start_beat, end_beat, audio_file_id, track_id, offset_seconds, gain } = data

			const newClip: Omit<Clip, 'created_at'> = {
				id: nanoid(),
				creator_user_id: user.id,
				creator_display_name: user.display_name,
				start_beat,
				end_beat,
				audio_file_id,
				gain: gain ?? DEFAULT_GAIN,
				offset_seconds: offset_seconds ?? 0,
				track_id,
			}

			try {
				const clip = await db.createClip(newClip)

				callback({
					success: true,
					data: clip,
				})

				socket.broadcast.emit('clip:create', clip)

				history.push({
					type: 'CLIP_CREATE',
					data: {
						payload: clip,
						inverse: clip.id,
					},
					userId: user.id,
				})
			} catch (err) {
				const error = err instanceof Error ? err.message : 'Unknown error'
				callback({
					success: false,
					error: {
						status: 'SERVER_ERROR',
						message: `Database error: ${error}`,
					},
				})
			}
		})

		socket.on('get:clip:delete', async (data, callback) => {
			const { id } = data

			try {
				const clip = await db.deleteClip(id)

				callback({
					success: true,
					data: {
						id: clip.id,
					},
				})

				socket.broadcast.emit('clip:delete', clip.id)

				history.push({
					type: 'CLIP_DELETE',
					userId: user.id,
					data: {
						payload: { id: clip.id },
						inverse: clip,
					},
				})
			} catch (err) {
				const error = err instanceof Error ? err.message : 'Unknown error'
				callback({
					success: false,
					error: {
						status: 'SERVER_ERROR',
						message: `Database error: ${error}`,
					},
				})
			}
		})

		socket.on('get:clip:update', async (data, callback) => {
			const { id, changes } = data

			try {
				const oldClip = await db.getClip(id)
				const clip = await db.updateClip(id, changes)

				callback({
					success: true,
					data: clip,
				})

				socket.broadcast.emit('clip:update', clip)

				if (oldClip) {
					const oldValues: Partial<Clip> = {}
					const keys = Object.keys(changes) as Array<keyof typeof changes>

					for (const key of keys) {
						oldValues[key] = oldClip[key] as any
					}

					history.push({
						type: 'CLIP_UPDATE',
						userId: user.id,
						data: {
							payload: { id, changes },
							inverse: { id, oldValues },
						},
					})
				}
			} catch (err) {
				const error = err instanceof Error ? err.message : 'Unknown error'
				callback({
					success: false,
					error: {
						status: 'SERVER_ERROR',
						message: `Database error: ${error}`,
					},
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

			try {
				const updatedUsername = await db.updateExistingUsername(
					user.id,
					cleanUsername.toLowerCase(),
				)

				callback({
					success: true,
					data: {
						username: updatedUsername,
					},
				})

				user.display_name = updatedUsername
			} catch (err) {
				const error = err instanceof Error ? err.message : 'Unknown error'
				callback({
					success: false,
					error: {
						status: 'SERVER_ERROR',
						message: `Database error: ${error}`,
					},
				})
			}

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

		socket.on('get:audiofile:delete', async (data, callback) => {
			const { id } = data

			// check wether or not this user is actually the creator of the audio file.
			// otherwise dont allow!!

			try {
				const audioFile = await db.getAudioFile(id)

				if (!audioFile || audioFile.creator_user_id !== user.id) {
					callback({
						success: false,
						error: {
							status: 'UNAUTHORIZED',
							message: 'You are not authorized to delete this audio file.',
						},
					})
					return
				}

				const result = await db.deleteAudioFile(id)

				const { deleted_clips, deleted_file } = result

				callback({
					success: true,
					data: {
						audio_file: { id },
						deleted_clips: deleted_clips,
					},
				})

				socket.broadcast.emit('audiofile:delete', {
					audio_file: { id },
					deleted_clips: deleted_clips,
				})

				const key = generateStorageKey(
					deleted_file.file_name,
					deleted_file.creator_user_id,
					deleted_file.id,
				)
				await store.deleteIfExists(key)
			} catch (err) {
				const error = err instanceof Error ? err.message : 'Unknown error'
				callback({
					success: false,
					error: {
						status: 'SERVER_ERROR',
						message: `Database error: ${error}`,
					},
				})
			}
		})

		socket.emit('server:ready', {
			user,
			audiofiles: await db.getAudioFiles(),
			clips: await db.getClips(),
			tracks: await db.getTracks(),
		})

		if (IN_DEV_MODE) ensureAllEventsHandled(socket.eventNames())
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
const apiRateLimiter = new RateLimiter(60 * 1000, 45) // 1 minute, 30 requests
const wsHandshakeRateLimiter = new RateLimiter(60 * 1000, 15) // 1 minute, 15 requests

app.use(
	'/*',
	cors({
		origin: (origin) => {
			const allowed = [
				'https://mega.mofalk.com',
				'http://localhost:5173',
				`http://localhost:${BACKEND_PORT}`,
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

// rate limit api auth & upload requests
app.use('/api/*', async (c, next) => {
	const ip = getSafeIp(c.req.raw.headers, 'unknown_fallback')

	const [allowed, remaining, resetTimeMs] = apiRateLimiter.allow(ip)

	c.header('Retry-After', (resetTimeMs - Date.now()).toString())
	c.header('X-RateLimit-Remaining', remaining.toString())

	if (allowed) {
		return await next()
	}

	return c.text('Rate limit exceeded', 429)
})

if (IN_DEV_MODE) {
	// Ensure dev.audiofiles dir
	const devFilesDir = join(import.meta.dir, '..', DEV_FILE_FOLDER)
	await setupDevelopmentFileHandlerRoutes({ app, devFilesDir })
}

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

app.get('/api/auth/signout', getSignOut)
app.get('/api/auth/discord/url', getDiscordOAuthUrl)
app.get('/api/auth/discord/callback', handleDiscordOAuthCallback)
app.get('/api/auth/twitch/url', getTwitchOAuthUrl)
app.get('/api/auth/twitch/callback', handleTwitchOAuthCallback)

const DIST_DIR = join(import.meta.dir, '..', 'dist')
app.use('/*', serveStatic({ root: DIST_DIR }))

// - It's not an API route
// - It's not a physical file (like /assets/logo.png)
// So we serve the index.html and let Vue Router handle the URL.
app.get('/*', async (c) => {
	return c.html(await Bun.file(join(DIST_DIR, 'index.html')).text())
})

const { websocket } = engine.handler()

Bun.serve({
	port: Bun.env['PORT'] || BACKEND_PORT,
	idleTimeout: 30,
	fetch(req, server) {
		const url = new URL(req.url)

		if (url.pathname === '/ws/') {
			const fallbackIp = server.requestIP(req)?.address || 'unknown_fallback'
			const ip = getSafeIp(req.headers, fallbackIp)
			const [allowed, remaining, resetTimeMs] = wsHandshakeRateLimiter.allow(ip)

			req.headers.set('x-mega-internal-rate-limit-remaining', remaining.toString())
			req.headers.set('x-mega-internal-is-rate-limited', allowed ? 'false' : 'true')
			req.headers.set('x-mega-internal-rate-limit-reset', resetTimeMs.toString())

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

function ensureAllEventsHandled(eventNames: (string | symbol)[]) {
	const requiredEvents = [
		...Object.keys(EVENTS.CLIENT_EMITS),
		...Object.keys(EVENTS.CLIENT_REQUESTS),
	]

	const missingEvents = requiredEvents.filter((event) => !eventNames.includes(event))

	if (missingEvents.length > 0) {
		print.server('Missing handlers for events:', missingEvents.join(', '))
	}
}
