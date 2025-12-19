import { io } from 'socket.io-client'
import { computed, shallowRef, watchEffect } from 'vue'
import kleur from 'kleur'
import z from 'zod'
import {
	EVENTS,
	type ClientEmitKeys,
	type ClientEmitPayload,
	type ClientRequestKeys,
	type ClientRequestPayload,
	type ClientRequestResponse,
	type ServerEmitKeys,
	type ServerEmitPayload,
} from '~/events'
import { BACKEND_PORT } from '~/constants'

const inDev = import.meta.env.MODE === 'development'
const websocketUrl = inDev ? `http://localhost:${BACKEND_PORT}` : ''

const _socketConnected = shallowRef<boolean>(false)
export const _socketReady = shallowRef<boolean>(false)

const socketReadyState = computed<'NOT_CONNECTED' | 'INITIALIZING' | 'READY'>(() => {
	return !_socketConnected.value ? 'NOT_CONNECTED' : !_socketReady.value ? 'INITIALIZING' : 'READY'
})

function print(type: 'log' | 'warn' | 'error', ...args: any[]) {
	console[type](kleur.cyan('[WEBSOCKET]'), ...args)
}

import { useDebug } from '@/composables/useDebug'
import router from '@/router'

useDebug(socketReadyState, { label: 'socket' })

const socketInstance = io(websocketUrl, {
	path: '/ws/',
	autoConnect: false,
	withCredentials: false,
	ackTimeout: 4000,
	transports: ['websocket'],
	secure: !inDev,
	multiplex: true,
	forceNew: false,
})

export const socket = {
	emit: safeEmit,
	emitWithAck: safeEmitWithAck,
	readyState: socketReadyState,
}

socketInstance.on('connect', () => {
	_socketConnected.value = true
	print('log', 'Connected', socketInstance.id?.slice(-6))
})

socketInstance.on('disconnect', (reason) => {
	_socketConnected.value = false
	_socketReady.value = false
	print('log', 'Disconnected:', reason)
})

export async function initializeSocket() {
	await registerEventHandlers()
	socketInstance.connect()
}

function safeEmit<K extends ClientEmitKeys>(event: K, data: ClientEmitPayload<K>) {
	const schema = EVENTS.CLIENT_EMITS[event]

	if (inDev) {
		const result = schema.safeParse(data)
		if (!result.success) {
			print('error', `emit: invalid input for ${event}`, result.error.issues)
			throw new Error(`Invalid input for ${event}`)
		}
	}

	socketInstance.emit(event, data)
}

async function safeEmitWithAck<K extends ClientRequestKeys>(
	event: K,
	data: ClientRequestPayload<K>,
): Promise<ClientRequestResponse<K>> {
	const def = EVENTS.CLIENT_REQUESTS[event]

	if (inDev) {
		const result = def.req.safeParse(data)
		if (!result.success) {
			return {
				success: false,
				error: {
					status: 'CLIENT_ERROR',
					originalError: result.error.issues,
					message: 'INVALID_INPUT',
				},
			} as ClientRequestResponse<K>
		}
	}

	try {
		const response = await socketInstance.emitWithAck(event, data)
		const parsed = def.res.parse(response)

		return parsed as ClientRequestResponse<K>
	} catch (err) {
		// socket.io errors / timeouts / netowrk issues
		return {
			success: false,
			error: {
				status: 'CLIENT_ERROR',
				message: 'NETWORK_ERROR, please refresh!',
				originalError: err,
			},
		} as ClientRequestResponse<K>
	}
}

async function registerEventHandlers() {
	const registered = new Set<ServerEmitKeys>()

	const modules = import.meta.glob<{ default: SocketEventHandler<ServerEmitKeys> }>(
		'./eventHandlers/*.ts',
		{
			eager: true,
		},
	)

	for (const path in modules) {
		const mod = modules[path]
		const { event, handler } = mod!.default

		if (!handler) {
			print('warn', `Skipping invalid event handler module: ${path}`)
			continue
		}

		if (registered.has(event)) {
			print('warn', `Duplicate handler detected for event '${event}' in module: ${path}`)
		}

		registered.add(event)

		// safety check
		socketInstance.off(event)

		socketInstance.on(event, async (data: unknown) => {
			try {
				const schema = EVENTS.SERVER_EMITS[event]
				const parsed = schema.parse(data)
				await handler(parsed)
			} catch (err) {
				if (err instanceof z.ZodError) {
					print('error', `Validation error for '${event}' event:\n`, err.issues)
				} else {
					print('error', `Caught error in '${event}' handler:`, err)
				}
			}
		})
	}

	if (inDev) {
		const requiredEvents = Object.keys(EVENTS.SERVER_EMITS) as ServerEmitKeys[]
		const missingEvents = requiredEvents.filter((event) => !registered.has(event))

		if (missingEvents.length > 0) {
			print('warn', `Missing handlers for events: ${missingEvents.join(' & ')}`)
		}
	}
}

export function defineSocketHandler<S extends ServerEmitKeys>(config: SocketEventHandler<S>) {
	return config
}

if (import.meta.hot) {
	import.meta.hot.accept(async () => {
		print('log', 'Hot Module Replacement')
		socketInstance.disconnect()
		// hmr needs to bubble to consumer
		import.meta.hot?.invalidate()
	})
}

type SocketEventHandler<K extends ServerEmitKeys> = {
	event: K
	handler: (data: ServerEmitPayload<K>) => void | Promise<void>
}

type InitSocketParams =
	| {
			inDevMode: true
			auth_token?: never
	  }
	| {
			inDevMode?: never
			auth_token: string
	  }
