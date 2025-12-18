import z from 'zod'
import {
	audioFileBaseSchema,
	clipSchema,
	UserSchema,
	AppErrorSchema,
	clientSchema,
	timelinePosSchema,
	type AppError,
	updateClipSchema,
	ClientTrackScema,
} from './schema'

export type ServerAckSchape<T> =
	| { success: true; data: T; error?: never }
	| { success: false; error: AppError; data?: T }

type EventDefinitions = {
	/**
	 * client emits, without response expectation from server
	 */
	CLIENT_EMITS: Record<string, z.ZodType>
	/**
	 *  server emits, without response expectation from client
	 */
	SERVER_EMITS: Record<string, z.ZodType>
	/**
	 * client requests, with response expectation from server
	 */
	CLIENT_REQUESTS: Record<
		string,
		{
			/**
			 * Payloud the client is expected to send!
			 */
			req: z.ZodType
			/**
			 * Payloud the server is expected to respond with but wrapped in `SocketAck`
			 */
			res: z.ZodType<ServerAckSchape<any>>
		}
	>
}

function defineRequest<Req extends z.ZodType, Res extends z.ZodType>(opts: { req: Req; res: Res }) {
	return {
		req: opts.req,
		res: z.discriminatedUnion('success', [
			z.object({ success: z.literal(true), data: opts.res, error: z.never().optional() }),
			z.object({ success: z.literal(false), error: AppErrorSchema, data: z.never().optional() }),
		]),
	}
}

export const EVENTS = Object.freeze({
	CLIENT_EMITS: {
		'emit:updatepos': timelinePosSchema,
	},
	SERVER_EMITS: {
		// when empty, use null, never undefined
		'server:refresh': z.null(),
		'server:ready': z.object({
			user: UserSchema,
			client: clientSchema,
			clips: z.array(clipSchema),
			audiofiles: z.array(audioFileBaseSchema),
			tracks: z.array(ClientTrackScema),
		}),
		'server:error': AppErrorSchema,
		'audiofile:create': audioFileBaseSchema,
		'audiofile:delete': audioFileBaseSchema.pick({ id: true }),
		'clip:create': clipSchema,
		'clip:update': clipSchema,
		'clip:delete': clipSchema.pick({ id: true }),
		'track:create': ClientTrackScema,
	},
	CLIENT_REQUESTS: {
		'get:ping': defineRequest({
			req: z.null(),
			res: z.null(),
		}),
		'get:upload:url': defineRequest({
			req: z.object({
				filename: z.string(),
				filetype: z.string(),
				filesize: z.number(),
			}),
			res: z.object({
				url: z.url(),
				file_id: z.string(),
				file_name: z.string(),
				color: z.string(),
				file_key: z.string(),
			}),
		}),
		'get:upload:finalize': defineRequest({
			req: z.object({
				file_key: z.string(),
				duration: z.number(),
			}),
			res: audioFileBaseSchema,
		}),
		'get:track:create': defineRequest({
			req: z.null(),
			res: ClientTrackScema,
		}),
		'get:clip:create': defineRequest({
			req: z.object({
				start_beat: z.number(),
				end_beat: z.number(),
				audio_file_id: z.string(),
				track_id: z.string(),
			}),
			res: clipSchema,
		}),
		'get:clip:delete': defineRequest({
			req: clipSchema.pick({ id: true }),
			res: clipSchema.pick({ id: true }),
		}),
		'get:clip:update': defineRequest({
			req: z.object({
				id: clipSchema.shape['id'],
				changes: updateClipSchema,
			}),
			res: clipSchema,
		}),
		'get:update:username': defineRequest({
			req: z.object({
				username: z.string(),
			}),
			res: z.object({
				username: z.string(),
			}),
		}),
		'get:undo': defineRequest({
			req: z.null(),
			res: z.null(),
		}),
	},
} as const satisfies EventDefinitions)

export type ClientEmits = typeof EVENTS.CLIENT_EMITS
export type ServerEmits = typeof EVENTS.SERVER_EMITS
export type ClientRequests = typeof EVENTS.CLIENT_REQUESTS

export type ClientEmitKeys = keyof ClientEmits
export type ServerEmitKeys = keyof typeof EVENTS.SERVER_EMITS
export type ClientRequestKeys = keyof typeof EVENTS.CLIENT_REQUESTS

export type ClientEmitPayload<K extends ClientEmitKeys> = z.infer<ClientEmits[K]>
export type ServerEmitPayload<K extends ServerEmitKeys> = z.infer<ServerEmits[K]>
export type ClientRequestPayload<K extends ClientRequestKeys> = z.infer<ClientRequests[K]['req']>
export type ClientRequestResponse<K extends ClientRequestKeys> = z.infer<ClientRequests[K]['res']>
