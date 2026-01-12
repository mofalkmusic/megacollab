import { db } from './database'
import { type Clip } from '~/schema'
import { print } from './utils'
import { type ServerEmitKeys, type ServerEmitPayload, type ClientRequestPayload } from '~/events'

const IN_DEV_MODE = Bun.env['ENV'] === 'development'

type HistoryEventMap = {
	CLIP_CREATE: {
		payload: ClientRequestPayload<'get:clip:create'> & { id: Clip['id'] }
		inverse: ServerEmitPayload<'clip:delete'>
	}
	CLIP_DELETE: {
		payload: ClientRequestPayload<'get:clip:delete'>
		inverse: ServerEmitPayload<'clip:create'>
	}
	CLIP_UPDATE: {
		payload: ClientRequestPayload<'get:clip:update'>
		inverse: { id: string; oldValues: Partial<Clip> }
	}
}

export type HistoryActionKey = keyof HistoryEventMap

type HistoryAction<K extends HistoryActionKey = HistoryActionKey> = {
	[P in K]: {
		type: P
		timestamp: number
		userId: string
		data: HistoryEventMap[P]
	}
}[K]

type BroadcastFn = <K extends ServerEmitKeys>(event: K, payload: ServerEmitPayload<K>) => void

class HistoryManager {
	private undoStack: HistoryAction[] = []
	private maxHistory = 100

	push<K extends HistoryActionKey>(action: Omit<HistoryAction<K>, 'timestamp'>) {
		const fullAction = { ...action, timestamp: Date.now() } as HistoryAction

		this.undoStack.push(fullAction)

		if (this.undoStack.length > this.maxHistory) {
			this.undoStack.shift()
		}
	}

	async undo(
		userId: string,
		socketBroadcast: BroadcastFn,
	): Promise<{ success: boolean; error?: string }> {
		// last action by this user
		const checkIndices: number[] = []

		for (let i = this.undoStack.length - 1; i >= 0; i--) {
			const action = this.undoStack[i]
			if (action && action.userId === userId) {
				checkIndices.push(i)
				break // Found the last one
			}
		}

		if (checkIndices.length === 0) return { success: false, error: 'Nothing to undo.' }

		const index = checkIndices[0]
		if (index === undefined) return { success: false, error: 'Nothing to undo.' }

		const action = this.undoStack[index]
		if (!action) return { success: false, error: 'Action not found.' }

		if (IN_DEV_MODE) {
			print.history(`Undoing ${action.type} for user ${userId}`)
		}

		try {
			let processed = false

			switch (action.type) {
				case 'CLIP_CREATE': {
					const clipId = action.data.payload.id

					let current: Awaited<ReturnType<typeof db.getClip>>

					try {
						current = await db.getClip(clipId)
					} catch {
						return { success: false, error: 'Failed to retrieve clip status.' }
					}

					if (current) {
						try {
							await db.deleteClip(clipId)
							socketBroadcast('clip:delete', clipId)
							processed = true
						} catch {
							return { success: false, error: 'Failed to delete clip.' }
						}
					} else {
						return {
							success: false,
							error: 'Clip was already deleted by someone else.',
						}
					}

					break
				}

				case 'CLIP_DELETE': {
					const clipId = action.data.payload.id

					let current: Awaited<ReturnType<typeof db.getClip>>

					try {
						current = await db.getClip(clipId)
					} catch {
						return { success: false, error: 'Failed to retrieve clip status.' }
					}

					if (!current) {
						const clip = action.data.inverse

						try {
							const restored = await db.createClip(clip)
							socketBroadcast('clip:create', restored)
							processed = true
						} catch {
							return { success: false, error: 'Failed to restore clip.' }
						}
					} else {
						return { success: false, error: 'Clip already exists (ID collision).' }
					}
					break
				}

				case 'CLIP_UPDATE': {
					const { id, oldValues } = action.data.inverse
					const { changes } = action.data.payload

					let current: Awaited<ReturnType<typeof db.getClip>>

					try {
						current = await db.getClip(id)
					} catch {
						return { success: false, error: 'Failed to retrieve clip status.' }
					}

					if (current) {
						let conflict = false
						const keys = Object.keys(changes) as Array<keyof typeof changes>

						for (const key of keys) {
							// verify current db state matches what we expect
							// nobody other than current user should have touched clip since last update
							const changeVal = changes[key]
							const currentVal = current[key]

							if (currentVal !== changeVal) {
								conflict = true
								break
							}
						}

						if (conflict) {
							return {
								success: false,
								error: 'Clip has been modified by someone else.',
							}
						}

						try {
							const updated = await db.updateClip(id, oldValues)
							socketBroadcast('clip:update', updated)
							processed = true
						} catch {
							return { success: false, error: 'Failed to revert clip update.' }
						}
					} else {
						return { success: false, error: 'Clip no longer exists.' }
					}
					break
				}
			}

			if (processed) {
				this.undoStack.splice(index, 1)
				return { success: true }
			} else {
				return { success: false, error: 'Unknown state error.' }
			}
		} catch (e) {
			if (IN_DEV_MODE) {
				print.history('Undo failed', e)
			}
			return { success: false, error: 'Internal server error during undo.' }
		}
	}
}

export const history = new HistoryManager()
