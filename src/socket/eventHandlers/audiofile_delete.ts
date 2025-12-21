import { defineSocketHandler } from '@/socket/socket'
import { audioBuffers, audiofiles, clips } from '@/state'
import type { AudioFile } from '@/types'
import { deleteAudioFile, deleteBitmaps } from '@/utils/workerPool'
import type { Clip } from '~/schema'

export default defineSocketHandler({
	event: 'audiofile:delete',
	handler: async (data) => {
		await deleteAudio(data.audio_file.id, data.deleted_clips)
	},
})

export async function deleteAudio(audio_file_id: AudioFile['id'], deleted_clip_ids: Clip['id'][]) {
	for (const clip_id of deleted_clip_ids) {
		clips.delete(clip_id)
	}

	audiofiles.delete(audio_file_id)
	audioBuffers.delete(audio_file_id)

	await Promise.allSettled([
		deleteAudioFile(audio_file_id, audio_file_id),
		deleteBitmaps(audio_file_id, audio_file_id),
	])
}
