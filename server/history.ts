import { db } from './database'
import { type Clip } from '~/schema'
import { print } from './utils'
import { type ServerEmitKeys, type ServerEmitPayload } from '~/events'

const IN_DEV_MODE = Bun.env['ENV'] === 'development'
type ActionType = 'CLIP_CREATE' | 'CLIP_DELETE' | 'CLIP_UPDATE'

interface HistoryAction {
	type: ActionType
	payload: any // todo: this is so lazy im sorry...
	inverse: any // todo: this is so lazy im sorry...
	timestamp: number
	userId: string
}

type BroadcastFn = <K extends ServerEmitKeys>(event: K, payload: ServerEmitPayload<K>) => void

class HistoryManager {
	private undoStack: HistoryAction[] = []
	private maxHistory = 100

	push(action: Omit<HistoryAction, 'timestamp'>) {
		this.undoStack.push({ ...action, timestamp: Date.now() })
		if (this.undoStack.length > this.maxHistory) {
			this.undoStack.shift()
		}
	}

	async undo(
		userId: string,
		socketBroadcast: BroadcastFn,
	): Promise<{ success: boolean; error?: string }> {
		// Find the last action by this user
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
					const clipId = action.payload.id // omg i hate that this is any... fix todo
					let current
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
						return { success: false, error: 'Clip was already deleted by someone else.' }
					}
					break
				}
				case 'CLIP_DELETE': {
					const clipId = action.payload.id
					let current
					try {
						current = await db.getClip(clipId)
					} catch {
						return { success: false, error: 'Failed to retrieve clip status.' }
					}

					if (!current) {
						const clip = action.inverse as Clip
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
					const { id, oldValues } = action.inverse
					const { changes } = action.payload

					let current
					try {
						current = await db.getClip(id)
					} catch {
						return { success: false, error: 'Failed to retrieve clip status.' }
					}
					if (current) {
						let conflict = false
						for (const key of Object.keys(changes)) {
							// @ts-expect-error key indexing
							if (current[key] !== changes[key]) {
								conflict = true
								break
							}
						}

						if (conflict) {
							return { success: false, error: 'Clip has been modified by someone else.' }
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
