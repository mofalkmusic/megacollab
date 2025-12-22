import type { Socket } from 'socket.io'
import type { ZodType } from 'zod'
import {
	EVENTS,
	type ClientEmitKeys,
	type ClientEmitPayload,
	type ClientRequestKeys,
	type ClientRequestPayload,
	type ClientRequestResponse,
	type ServerEmitKeys,
	type ServerEmitPayload,
	type ServerAckSchape,
} from '~/events'
// import { RateLimiter } from './ratelimiter'

const IN_DEV_MODE = Bun.env['ENV'] === 'development'

export type ServerToClientEvents = {
	[K in ServerEmitKeys]: (payload: ServerEmitPayload<K>) => void
}

export type ClientToServerEvents = {
	[K in ClientEmitKeys]: (payload: ClientEmitPayload<K>) => void
} & {
	[K in ClientRequestKeys]: (
		payload: ClientRequestPayload<K>,
		callback: (res: ClientRequestResponse<K>) => void,
	) => void
}

export type SocketData = {
	userId: string
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents, {}, SocketData>

// todo: limit the socket events that actually are hard to compute!
// not used for HIGH VOLUME EVENTS THAT DONT HIT THE DB (eg. ping, position update etc..)
// const socketRateLimiter = new RateLimiter(60 * 1000, 1000) // 1 minute, 1000 requests

/**
 * Socket.io custom-event only middleware
 *
 * Ensures that:
 * - event data is parsed and valid
 * - callback is always valid
 */
export function validateIncomingEvents(socket: TypedSocket) {
	socket.use(([event, data, callback], nextFn) => {
		// Ignore native/unknown events

		const isClientEmit = Object.hasOwn(EVENTS.CLIENT_EMITS, event)
		const isClientRequest = Object.hasOwn(EVENTS.CLIENT_REQUESTS, event)
		const isServerEmit = Object.hasOwn(EVENTS.SERVER_EMITS, event)

		if (!isClientEmit && !isClientRequest) {
			if (isServerEmit) {
				if (IN_DEV_MODE) console.warn('Client is not allowed to send', event, "It's a server emit.")
				return
			}
			// let default ws & socket.io events pass
			return nextFn()
		}

		// this is safe since previous if would catch any unsafe events
		const schema = isClientRequest
			? EVENTS.CLIENT_REQUESTS[event as ClientRequestKeys].req
			: EVENTS.CLIENT_EMITS[event as ClientEmitKeys]

		const parsed = schema.safeParse(data)

		if (!parsed.success) {
			if (typeof callback === 'function') {
				callback({
					success: false,
					error: {
						status: 'BAD_REQUEST',
						message: 'Bad request data',
						field: parsed.error.issues[0]?.message,
					},
				} satisfies ServerAckSchape<ZodType>)
			}
			return
		}

		// enforces callback for requests
		if (isClientRequest && typeof callback !== 'function') {
			if (IN_DEV_MODE) console.warn('no valid callback func provided for client requst.')
			return
		}

		nextFn()
	})
}
