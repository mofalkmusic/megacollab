import { defineSocketHandler } from '@/socket/socket'
import { _socketReady } from '@/socket/socket'
import { audiofiles, clips, tracks, user } from '@/state'
import { ingestNewAudioFileMetadata } from '@/utils/preProcessAudio'
import { pruneAudioCache } from '@/utils/workerPool'
import { makeAudioFileHash } from '~/utils'
import { useConsole } from '@/composables/useConsole'

const { userLog } = useConsole()

export default defineSocketHandler({
	event: 'server:ready',
	handler: async ({
		user: u,
		audiofiles: serverAudiofiles,
		clips: serverClips,
		tracks: serverTracks,
	}) => {
		user.value = u

		_socketReady.value = true

		for (const track of serverTracks) {
			tracks.set(track.id, track)
		}

		for (const audiofile of serverAudiofiles) {
			audiofiles.set(audiofile.id, {
				...audiofile,
				hash: makeAudioFileHash({
					creator_user_id: audiofile.creator_user_id,
					file_name: audiofile.file_name,
					duration: audiofile.duration,
				}),
			})
		}

		for (const clip of serverClips) {
			clips.set(clip.id, clip)
		}

		try {
			await ingestNewAudioFileMetadata(serverAudiofiles, {
				onProgress: (p) => {
					// useDebug(() => p, { label: 'init progress' })
				},
				onAllComplete: async () => {
					await pruneAudioCache(serverAudiofiles.map((f: { id: string }) => f.id))
					userLog('SYSTEM', 'Audio initialization completed', { textColor: 'gray' })
				},
			})
		} catch (err) {
			userLog('SYSTEM', 'Audio initialization failed. Refresh to try again.', {
				textColor: 'red',
			})
			console.error('Failed to init audio files', err)
		}
	},
})
