import { defineSocketHandler } from '@/socket/socket'
import { audiofiles } from '@/state'
import { ingestNewAudioFileMetadata } from '@/utils/preProcessAudio'
import { makeAudioFileHash } from '~/utils'
import { useConsole } from '@/composables/useConsole'

const { userLog } = useConsole()

export default defineSocketHandler({
	event: 'audiofile:create',
	handler: async (data) => {
		try {
			audiofiles.set(data.id, {
				...data,
				hash: makeAudioFileHash({
					creator_user_id: data.creator_user_id,
					file_name: data.file_name,
					duration: data.duration,
				}),
			})

			await ingestNewAudioFileMetadata(data)
		} catch (err) {
			userLog('SYSTEM', `Audio file creation failed: ${data.file_name}`, {
				textColor: 'red',
			})

			console.error(`Failed to create audio file: ${data.file_name}`, err)
		}
	},
})
