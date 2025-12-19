import { _socketReady, defineSocketHandler, socket } from '@/socket/socket'
import { audiofiles, client, clips, tracks, user } from '@/state'
import { ingestNewAudioFileMetadata } from '@/utils/preProcessAudio'
import { pruneAudioCache } from '@/utils/workerPool'
import { useToast } from '@/composables/useToast'
import { useDebug } from '@/composables/useDebug'
import { makeAudioFileHash } from '~/utils'

const { addToast } = useToast()

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
					useDebug(() => p, { label: 'init progress' })
				},
				onAllComplete: async () => {
					await pruneAudioCache(serverAudiofiles.map((f: { id: string }) => f.id))
					addToast({
						type: 'notification',
						title: 'Audio initialization complete',
						message: 'Audio files processed successfully',
						icon: 'success',
						priority: 'low',
					})
				},
			})
		} catch (err) {
			addToast({
				type: 'notification',
				title: 'Audio initialization failed',
				message: 'Failed to process audio files',
				icon: 'warning',
				priority: 'high',
			})
			console.error('Failed to init audio files', err)
		}
	},
})
