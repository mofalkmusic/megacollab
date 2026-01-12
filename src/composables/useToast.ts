import { nanoid } from 'nanoid'
import { toasts } from '@/state'

const LIFETIME_DEFAULT_MS = 3200 as const

// todo: this should be overhauled :D its awfully complex rn :D
// and it needs a way to only deplete visible toast elements instead of all.
// should be change don toastitem i think!

export function useToast() {
	function addToast(opts: ToastInputOptions): void {
		const id = nanoid()
		const createdAtMs = Date.now()

		let toast: Toast

		if (opts.type === 'notification') {
			const lifetimeMs = opts.lifetimeMs || LIFETIME_DEFAULT_MS
			toast = {
				...opts,
				id,
				createdAtMs,
				type: opts.type,
				priority: opts.priority || 'low',
				lifetimeMs,
			}
		} else if (opts.type === 'acknowledgement_request') {
			const priority = opts.priority || 'low'
			const autoConfirm = priority === 'low' || priority === 'medium'
			const lifetimeMs =
				opts.lifetimeMs || (autoConfirm ? LIFETIME_DEFAULT_MS * 1.5 : undefined)

			const onConfirm = {
				func:
					opts.onConfirm?.func ||
					((toast) => {
						removeToast(toast.id)
					}),
				label: opts.onConfirm?.label || 'Understood',
			}

			toast = {
				...opts,
				id,
				createdAtMs,
				type: opts.type,
				priority,
				onConfirm,
				lifetimeMs,
			}
		} else if (opts.type === 'action_request') {
			const priority = opts.priority || 'low'
			const autoConfirm = priority === 'low' || priority === 'medium'
			const lifetimeMs =
				opts.lifetimeMs || (autoConfirm ? LIFETIME_DEFAULT_MS * 1.5 : undefined)

			const onConfirm = {
				func:
					opts.onConfirm?.func ||
					((toast) => {
						removeToast(toast.id)
					}),
				label: opts.onConfirm?.label || 'Confirm',
			}

			toast = {
				...opts,
				id,
				createdAtMs,
				type: opts.type,
				priority,
				onConfirm,
				onDeny: {
					func:
						opts.onDeny?.func ||
						((toast) => {
							removeToast(toast.id)
						}),
					label: opts.onDeny?.label || 'Deny',
				},
				lifetimeMs,
			}
		} else {
			throw new Error(`Invalid toast type`)
		}

		const p = getPriority(toast.priority)
		const index = toasts.value.findIndex((t) => getPriority(t.priority) < p)

		if (index === -1) {
			toasts.value.push(toast)
			return
		}

		toasts.value.splice(index, 0, toast)
	}

	function removeToast(id: Toast['id']): void {
		const index = toasts.value.findIndex((t) => t.id === id)
		if (index === -1) return

		const toast = toasts.value[index]
		if (!toast) return

		toasts.value.splice(index, 1)
	}

	return { addToast, removeToast }
}

function getPriority(p: Toast['priority']): number {
	switch (p) {
		case 'low':
			return 1
		case 'medium':
			return 2
		case 'high':
			return 3
		default:
			throw new Error(`Invalid toast priority: ${p}`)
	}
}

type BaseToast = {
	id: string
	createdAtMs: number
	priority: 'low' | 'medium' | 'high'
	message: string
	title?: string
	icon?: 'info' | 'warning' | 'success' | 'mail'
	lifetimeMs?: number
}

type ToastCallback = {
	func: (toast: Toast) => void
	label: string
}

type ToastNotification = BaseToast & {
	type: 'notification'
	lifetimeMs: number
}

type ToastAcknowledgement = BaseToast & {
	type: 'acknowledgement_request'
	onConfirm: ToastCallback
}

type ToastActionRequest = BaseToast & {
	type: 'action_request'
	onConfirm: ToastCallback
	onDeny: ToastCallback
}

export type Toast = ToastNotification | ToastAcknowledgement | ToastActionRequest

export type ToastUpdateOptionsBase = Omit<BaseToast, 'id' | 'createdAtMs' | 'priority'> & {
	priority?: BaseToast['priority']
}

export type ToastInputOptions = ToastUpdateOptionsBase &
	(
		| {
				type: 'notification'
				lifetimeMs?: number
		  }
		| {
				type: 'acknowledgement_request'
				onConfirm?: Partial<ToastCallback>
				lifetimeMs?: number
		  }
		| {
				type: 'action_request'
				onConfirm?: Partial<ToastCallback>
				onDeny?: Partial<ToastCallback>
				lifetimeMs?: number
		  }
	)
