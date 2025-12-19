import z from 'zod'

// AUDIO FILES

export const audioFileBaseSchema = z.object({
	id: z.string(),
	creator_user_id: z.string(), // foreign key
	file_name: z.string(),
	public_url: z.string(),
	duration: z.number(),
	created_at: z.iso.datetime({ offset: true }),
	color: z.string(),
})

export type AudioFileBase = z.output<typeof audioFileBaseSchema>

// CLIPS

export const clipSchema = z.object({
	id: z.string(),
	track_id: z.string(), // foreign key
	audio_file_id: z.string(), // foreign key
	creator_user_id: z.string(), // foreign key
	start_beat: z.number(),
	end_beat: z.number(),
	offset_seconds: z.number(),
	gain_db: z.number(),
	created_at: z.iso.datetime({ offset: true }),
})

export type Clip = z.output<typeof clipSchema>

export const updateClipSchema = clipSchema
	.omit({ id: true, created_at: true, audio_file_id: true, creator_user_id: true })
	.partial()

export type UpdateClip = z.output<typeof updateClipSchema>

// TRACKS

export const ServerTrackSchema = z.object({
	id: z.string(),
	creator_user_id: z.string(), // foreign key
	belongs_to_user_id: z.string().nullable(), // foreign key + null for editable by all
	title: z.string().nullable(),
	order_index: z.number(),
	gain_db: z.number(),
	created_at: z.iso.datetime({ offset: true }),
})

export type ServerTrack = z.output<typeof ServerTrackSchema>

export const ClientTrackScema = ServerTrackSchema.extend({
	belongs_to_display_name: z.string().nullable(), // from foreign key
})

export type ClientTrack = z.output<typeof ClientTrackScema>

// USER regards mostly the Clerk / authentication schemas & types

export const UserSchema = z.object({
	id: z.string(),
	email: z.email(),
	created_at: z.iso.datetime(),
	display_name: z.string(),
})

export type User = z.infer<typeof UserSchema>

// CLIENTS extend user

export const timelinePosSchema = z.object({
	beat: z.number().positive(),
	trackId: z.string(),
	trackYOffset: z.number().min(0).max(1),
})

export type TimelinePos = z.output<typeof timelinePosSchema>

export const clientSchema = z.object({
	color: z.string(),
	postition: timelinePosSchema.nullable(),
	roles: z
		.array(z.enum(['regular', 'vip', 'mod', 'admin']))
		.min(1)
		.default(['regular']),
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

export const AppErrorSchema = z.discriminatedUnion('status', [
	UnauthenticatedError,
	ServerError,
	BadRequestError,
	ClientError,
	UnauthorizedError,
	ConflictError,
])

export type AppError = z.infer<typeof AppErrorSchema>

export class ServiceError extends Error {
	constructor(public readonly error: AppError) {
		super(error.message)
	}
}
