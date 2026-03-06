import { globalProgresses } from '@/state'
import { nanoid } from 'nanoid'

export type StartProgressOptions = {
	id?: string
	label?: string
	ttlMs?: number
}

export const useGlobalProgress = (opts: StartProgressOptions = {}) => {
	const id = opts.id || nanoid(6)
	const ttlMs = opts.ttlMs || 30000

	// If we have existing items but they are all done (progress 100),
	// we clear them to start a fresh batch.
	const allDone =
		globalProgresses.size > 0 && [...globalProgresses.values()].every((p) => p.progress === 100)

	if (allDone) {
		globalProgresses.clear()
	}

	globalProgresses.set(id, {
		progress: 0,
		expiresAt: Date.now() + ttlMs,
		label: opts.label,
	})

	const update = (progress: number, updateOpts: { ttlMs?: number } = {}) => {
		const existing = globalProgresses.get(id)
		if (!existing || existing.progress === 100) return

		globalProgresses.set(id, {
			progress,
			expiresAt: Date.now() + (updateOpts.ttlMs || ttlMs),
			label: existing.label,
		})
	}

	const done = () => {
		const existing = globalProgresses.get(id)
		if (!existing) return

		// Mark this one as done
		globalProgresses.set(id, {
			...existing,
			progress: 100,
		})

		// Check if EVERYTHING in the map is now done
		const everythingDone = [...globalProgresses.values()].every((p) => p.progress === 100)

		if (everythingDone) {
			// If everything is done, we set a quick expiration for all of them
			const doneExpiresAt = Date.now() + 1500
			for (const [key, val] of globalProgresses.entries()) {
				globalProgresses.set(key, {
					...val,
					expiresAt: doneExpiresAt,
				})
			}
		} else {
			// Keep it alive as part of the batch until others finish
			globalProgresses.set(id, {
				...existing,
				progress: 100,
				expiresAt: Date.now() + 30000,
			})
		}
	}

	return {
		id,
		update,
		done,
		error: done,
	}
}
