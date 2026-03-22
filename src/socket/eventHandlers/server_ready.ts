import { defineSocketHandler } from '@/socket/socket'
import { _socketReady } from '@/socket/socket'
import { audiofiles, clips, tracks, user, chats } from '@/state'
import { ingestNewAudioFileMetadata } from '@/utils/preProcessAudio'
import { pruneAudioCache } from '@/utils/workerPool'
import { makeAudioFileHash } from '~/utils'
import { useConsole } from '@/composables/useConsole'

const { userLog } = useConsole()

let lastBuildId: string | null = null

export default defineSocketHandler({
	event: 'server:ready',
	handler: async ({
		buildId,
		user: u,
		audiofiles: serverAudiofiles,
		clips: serverClips,
		tracks: serverTracks,
		chats: serverChats,
	}) => {
		if (lastBuildId !== null && lastBuildId !== buildId) {
			userLog('SYSTEM', 'New version of the site available. Please refresh the page.', {
				textColor: 'yellow',
				isBold: true,
			})
		}

		lastBuildId = buildId

		user.value = u

		_socketReady.value = true

		for (const track of serverTracks) {
			tracks.set(track.id, track)
		}

		for (const audiofile of serverAudiofiles) {
			audiofiles.set(audiofile.id, {
				...audiofile,
				file_name: audiofile.file_name,
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

		chats.clear()

		for (const chat of serverChats) {
			chats.set(chat.id, chat)

			userLog('CHAT', chat.text, {
				textColor: chat.color,
				display_name: chat.creator_display_name,
				user_id: chat.creator_user_id,
				reply_to_id: chat.reply_to_id,
			})
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
