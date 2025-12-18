import { verifyToken } from '@clerk/backend'
import { nanoid } from 'nanoid'
import { type AppError, type User } from '~/schema'
import { getRandomName } from './utils'
import z from 'zod'

/**
 * Whether to randomize the dev user ID. This is useful for testing
 * interactions between different clients in dev through separate tabs.
 * 
 * Has no effect in production.
 */
const RANDOMIZE_DEV_USER_ID: boolean = true


export const SessionMinimumSchema = z.object({
	user_id: z.string(),
	username: z.string().nullable().optional(),
	created_at: z.number(),
	email: z.string(),
})

export type SessionMin = z.infer<typeof SessionMinimumSchema>

const CLERK_SECRET = Bun.env['CLERK_SECRET_KEY']

type AuthResult =
	| { success: false; error: AppError; user?: never }
	| { success: true; error?: never; user: User }

export const devUser: User = {
	created_at: new Date(Date.now()).toISOString(),
	display_name: getRandomName(),
	email: 'local@dev.net',
	id: nanoid(),
} as const



export async function manageAuthentication(token: any, inDevMode: boolean): Promise<AuthResult> {
	if (inDevMode) {
		return {
			success: true,
			user: {
				...devUser,
				id: RANDOMIZE_DEV_USER_ID ? nanoid() : devUser.id,
				display_name: RANDOMIZE_DEV_USER_ID ? getRandomName() : devUser.display_name,
			},
		}
	}

	if (!token) {
		return {
			success: false,
			error: {
				status: 'UNAUTHENTICATED',
				message: 'Must be authenticated in to access. Please log in first.',
				redirectUrl: '/login',
			},
		}
	}

	let tokenPayload

	try {
		if (!CLERK_SECRET) {
			return {
				success: false,
				error: {
					status: 'SERVER_ERROR',
					message: 'Missing server configuration.',
				},
			}
		}

		tokenPayload = await verifyToken(token, {
			secretKey: CLERK_SECRET,
		})
	} catch (err) {
		return {
			success: false,
			error: {
				status: 'UNAUTHENTICATED',
				message: 'Invalid or expired session. Please log in again.',
				redirectUrl: '/login',
			},
		}
	}

	const { success, data } = SessionMinimumSchema.safeParse(tokenPayload)

	if (!success) {
		return {
			success: false,
			error: {
				status: 'UNAUTHENTICATED',
				message: 'Expired or corrupted session. Please log in again.',
				redirectUrl: '/login',
			},
			// todo: redirect on client to login
		}
	}

	return {
		success: true,
		user: {
			id: data.user_id,
			created_at: new Date(data.created_at).toISOString(),
			display_name: data.username || getRandomName(data.user_id),
			email: data.email,
		},
	}
}
