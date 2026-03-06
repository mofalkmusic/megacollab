import z from 'zod'
import {
	UserSchema,
	type User,
	type ServerTrack,
	type ClientTrack,
	type ServerClip,
	type ClientClip,
	type ServerAudioFile,
	type ClientAudioFile,
} from './schema'

const MethodSchema = z.enum(['create', 'update', 'delete', 'read'])
type Method = z.infer<typeof MethodSchema>

const ResourceSchema = z.enum(['track', 'clip', 'audio_file', 'user'])
type Resource = z.infer<typeof ResourceSchema>

export type PolicyAction = `${Method}:${Resource}`

export type ResourceDataType = {
	[ResourceSchema.enum.track]: ServerTrack | ClientTrack
	[ResourceSchema.enum.clip]: ServerClip | ClientClip
	[ResourceSchema.enum.audio_file]: ServerAudioFile | ClientAudioFile
	[ResourceSchema.enum.user]: User
}

type PolicyHandler<R extends keyof ResourceDataType> = (
	user: User,
	data?: ResourceDataType[R],
) => PolicyResult

type PoliciesMap = {
	[R in Resource]?: Partial<Record<Method, PolicyHandler<R>>>
}

const THE_POLICY: PoliciesMap = {
	track: {
		delete: (user, data) => {
			if (isPriviledged(user.roles)) return { allowed: true }
			if (data && user.id === data.belongs_to_user_id) return { allowed: true }
			return { allowed: false }
		},
	},
} as const

export type ResourceFromAction<A extends PolicyAction> = A extends `${string}:${infer R}`
	? R extends Resource
		? R
		: never
	: never

export function checkPolicy<A extends PolicyAction>(
	action: A,
	user: User | undefined | null,
	data?: ResourceDataType[ResourceFromAction<A>],
): PolicyCheckResult {
	let m: unknown
	let r: unknown

	try {
		;[m, r] = action.split(':')
	} catch (_) {
		return {
			allowed: false,
			reason: `Internal error: Policy action "${action}" malformatted. Please reach out.`,
		}
	}

	let method: Method
	let resource: Resource

	try {
		method = MethodSchema.parse(m)
		resource = ResourceSchema.parse(r)
	} catch (_) {
		return {
			allowed: false,
			reason: `Internal error: Invalid method/resource pair. Please reach out.`,
		}
	}

	const policy = THE_POLICY[resource]?.[method]

	if (policy == undefined || !policy) return { allowed: true }

	if (!user) return { allowed: false, reason: 'You must be logged in to perform this action.' }

	if (!UserSchema.safeParse(user).success) {
		console.log(UserSchema.safeParse(user).error)
		return {
			allowed: false,
			reason: 'User data corrupted. Please sign out and in again. If this issue persists, please reach out.',
		}
	}

	if (user.roles.includes('banned')) {
		const addINGtoMessage = method === 'read' ? method + 'ing' : method.slice(0, -1) + 'ing'

		return {
			allowed: false,
			reason: `You are banned from ${addINGtoMessage} ${resource}s.`,
		}
	}

	const policyHandler = policy as PolicyHandler<ResourceFromAction<A>>
	const { allowed, reason } = policyHandler(user, data)

	if (allowed) return { allowed }

	return { allowed, reason: reason ?? 'You do not have permission to perform this action.' }
}

type PolicyResult =
	| {
			allowed: true
			reason?: never
	  }
	| {
			allowed: false
			reason?: string
	  }

export type PolicyCheckResult =
	| {
			allowed: true
			reason?: never
	  }
	| {
			allowed: false
			reason: string
	  }

function isPriviledged(roles: User['roles'], opts?: { countVip?: boolean }) {
	const { countVip } = opts ?? {}

	return roles.some((e) => {
		if (e === 'admin' || e === 'mod') return true
		if (e === 'vip' && countVip) return true
		return false
	})
}
