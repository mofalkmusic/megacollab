import { defineSocketHandler } from '@/socket/socket'
import { clips } from '@/state'
import type { ClipClient } from '~/schema'

export default defineSocketHandler({
	event: 'clip:update',
	handler: (clipsToUpdate) => {
		updateClips(clipsToUpdate)
	},
})

export function updateClips(clipsToUpdate: ClipClient[]) {
	for (const clip of clipsToUpdate) {
		const existing = clips.get(clip.id)
		if (!existing) {
			clips.set(clip.id, clip)
			continue
		}

		clips.set(clip.id, {
			...existing,
			...clip,
		})
	}
}
