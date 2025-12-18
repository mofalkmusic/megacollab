import { Hono } from 'hono'
import { clerkMiddleware, getAuth } from '@hono/clerk-auth'
import { cors } from 'hono/cors'
import { serveStatic } from 'hono/bun'
import { print, randomSafeHexColor, setupDevelopmentFileHandlerRoutes } from './utils'
import { Server as SocketIOServer } from 'socket.io'
import { Server as BunEngine } from '@socket.io/bun-engine'
import { db } from './database'
import { manageAuthentication } from './auth'
import {
	validateIncomingEvents,
	type ClientToServerEvents,
	type ServerToClientEvents,
	type SocketData,
} from './socket'
import { extname, join } from 'path'

import { DEV_FILE_FOLDER, MAX_UPLOAD_FILE_SIZE_BYTES } from './constants'
import { store } from './store'
import { nanoid } from 'nanoid'
import { type AudioFileBase, type Clip, type ServerTrack } from '~/schema'
import { EVENTS } from '~/events'
import { audioMimeTypes, BACKEND_PORT } from '~/constants'
import { sanitizeLetterUnderscoreOnly } from '~/utils'

// const BACKEND_PORT = Bun.env['VITE_APP_DEV_SERVER_PORT'] ?? '5000'
const CLERK_SECRET = Bun.env['CLERK_SECRET_KEY']
const CLERK_PUBLIC = Bun.env['VITE_APP_CLERK_PUBLISHABLE_KEY']
const IN_DEV_MODE = Bun.env['ENV'] === 'development'
const PROD_FOLDER = Bun.env['PROD_FOLDER']

await db.migrateAndSeedDb()

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
const io = new SocketIOServer<ClientToServerEvents, ServerToClientEvents, {}, SocketData>()
const engine = new BunEngine()

io.bind(engine)

// Event register at ../shared/events.ts
io.on('connection', async (socket) => {
	try {
		const token = socket.handshake.auth['token']
		const { success, error, user: userAuth } = await manageAuthentication(token, IN_DEV_MODE)

		if (!success) {
			socket.emit('server:error', error)
			socket.disconnect()
			return
		}

		socket.data.userId = userAuth.id

		const user = await db.getFullClientByUser(userAuth)

		if (!user) {
			socket.emit('server:error', {
				status: 'SERVER_ERROR',
				message: 'Oops, database error... Please try reconnecting.',
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
		})

		socket.on('get:clip:update', async (data, callback) => {
			const { id, changes } = data

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

		socket.emit('server:ready', {
			user,
			client: { color: '#666666ff', postition: null, roles: ['regular'] },
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

// todo: check
app.use(
	'/*',
	cors({
		origin: (origin) => origin, // Allow any origin in dev, or specific ones
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

if (!IN_DEV_MODE) {
	app.use('*', clerkMiddleware({ secretKey: CLERK_SECRET, publishableKey: CLERK_PUBLIC }))
}

if (IN_DEV_MODE) {
	// Ensure dev.audiofiles dir
	const devFilesDir = join(import.meta.dir, '..', DEV_FILE_FOLDER)
	await setupDevelopmentFileHandlerRoutes({ app, devFilesDir })
}

app.get('/api/hello', (c) => c.json({ hello: 'world' }))

app.get('/api/auth/verify', async (c) => {
	const auth = getAuth(c)
	if (!auth?.userId) return c.text('Unauthorized', 401)
	return c.json({ user: auth.userId, sessionId: auth.sessionId })
})

app.use('/*', serveStatic({ root: './dist' }))

// 4. THE FALLBACK ROUTE
// This must be the last route. If the request reaches here, it means:
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

// mo was here :)