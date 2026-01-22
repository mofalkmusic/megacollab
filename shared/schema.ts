import z from 'zod'

// AUDIO FILES

export const ServerAudioFileSchema = z.object({
	id: z.string(),
	creator_user_id: z.string(), // foreign key
	file_name: z.string(),
	public_url: z.string(),
	duration: z.number(),
	created_at: z.iso.datetime({ offset: true }),
	color: z.string(),
})

export type ServerAudioFile = z.output<typeof ServerAudioFileSchema>

export const ClientAudioFileSchema = ServerAudioFileSchema.extend({
	creator_display_name: z.string(),
})

export type ClientAudioFile = z.output<typeof ClientAudioFileSchema>

// CLIPS

export const ServerClipSchema = z.object({
	id: z.string(),
	track_id: z.string(), // foreign key
	audio_file_id: z.string(), // foreign key
	creator_user_id: z.string(), // foreign key
	start_beat: z.number(),
	end_beat: z.number(),
	offset_seconds: z.number(),
	gain: z.number(),
	created_at: z.iso.datetime({ offset: true }),
})

export type ServerClip = z.output<typeof ServerClipSchema>

export const ClientClipSchema = ServerClipSchema.extend({
	creator_display_name: z.string(),
})

export type ClientClip = z.output<typeof ClientClipSchema>

export type Clip = ClientClip

export const updateClipSchema = ServerClipSchema.omit({
	id: true,
	created_at: true,
	audio_file_id: true,
	creator_user_id: true,
}).partial()

export type UpdateClip = z.output<typeof updateClipSchema>

// TRACKS

export const ServerTrackSchema = z.object({
	id: z.string(),
	creator_user_id: z.string(), // foreign key
	belongs_to_user_id: z.string().nullable(), // foreign key + null for editable by all
	title: z.string().nullable(),
	order_index: z.number(),
	gain: z.number(),
	created_at: z.iso.datetime({ offset: true }),
})

export type ServerTrack = z.output<typeof ServerTrackSchema>

export const ClientTrackScema = ServerTrackSchema.extend({
	belongs_to_display_name: z.string().nullable(), // from foreign key
})

export type ClientTrack = z.output<typeof ClientTrackScema>

export const updateTrackSchema = ServerTrackSchema.omit({
	id: true,
	created_at: true,
	creator_user_id: true,
}).partial()

export type UpdateTrack = z.output<typeof updateTrackSchema>

// USER regards mostly the Clerk / authentication schemas & types

// export const UserSchema = z.object({
// 	id: z.string(),
// 	email: z.email(),
// 	created_at: z.iso.datetime(),
// 	display_name: z.string(),
// })

// export type User = z.infer<typeof UserSchema>

export const UserSchema = z.object({
	id: z.string(),
	created_at: z.iso.datetime({ offset: true }),
	display_name: z.string(),
	provider: z.enum(['twitch', 'discord', 'dev']),
	provider_id: z.string(),
	provider_email: z.string(),
	color: z.string(),
	roles: z
		.array(z.enum(['regular', 'vip', 'mod', 'admin']))
		.min(1)
		.default(['regular']),
	banned_at: z.iso.datetime({ offset: true }).nullable(),
	ban_reason: z.string().nullable(),
	// not storing refresh keys and access keys for now...
})

export type User = z.infer<typeof UserSchema>

// CLIENTS extend user

export const timelinePosSchema = z.object({
	beat: z.number().positive(),
	trackId: z.string(),
	trackYOffset: z.number(),
})

export type TimelinePos = z.output<typeof timelinePosSchema>

export const clientSchema = z.object({
	postition: timelinePosSchema.nullable(),
})

export type Client = z.output<typeof clientSchema>

// ERROR

const BaseError = z.object({
	message: z.string(),
})

const UnauthenticatedError = BaseError.extend({
	status: z.literal('UNAUTHENTICATED'),
	redirectUrl: z.string(),
})

const UnauthorizedError = BaseError.extend({
	status: z.literal('UNAUTHORIZED'),
})

const ServerError = BaseError.extend({
	status: z.literal('SERVER_ERROR'),
})

const BadRequestError = BaseError.extend({
	status: z.literal('BAD_REQUEST'),
	field: z.string().optional(),
})

const ClientError = BaseError.extend({
	status: z.literal('CLIENT_ERROR'),
	originalError: z.any().optional(),
	message: z.enum(['INVALID_INPUT', 'RESPONSE_PARSE']),
})

const ConflictError = BaseError.extend({
	status: z.literal('CONFLICT_ERROR'),
})

const RateLimitExceededError = BaseError.extend({
	status: z.literal('RATE_LIMIT_EXCEEDED'),
	tryAgainAtMs: z.number(),
})

export const AppErrorSchema = z.discriminatedUnion('status', [
	UnauthenticatedError,
	ServerError,
	BadRequestError,
	ClientError,
	UnauthorizedError,
	ConflictError,
	RateLimitExceededError,
])

export type AppError = z.infer<typeof AppErrorSchema>

export class ServiceError extends Error {
	constructor(public readonly error: AppError) {
		super(error.message)
	}
}
