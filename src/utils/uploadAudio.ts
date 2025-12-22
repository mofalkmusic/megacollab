import type { AudioFile } from '@/types'
import { audioMimeTypes } from '~/constants'
import { socket } from '@/socket/socket'
import { audioContext } from '@/audioEngine'
import { cacheAudioFile, cacheBitmaps, computePeaks } from '@/utils/workerPool'
import { activeUploads, audioBuffers, audiofiles, clips, user } from '@/state'
import { useToast } from '@/composables/useToast'
import { makeAudioFileHash, sanitizeLetterUnderscoreOnly } from '~/utils'

const { addToast, removeToast } = useToast()

type AudioCreateResult =
	| { success: false; reason?: string; id?: never; duration?: never; uploadPromise?: never }
	| {
			success: true
			id: string
			duration: number
			reason?: never
			uploadPromise: Promise<void>
	  }

export async function optimisticAudioCreateUpload(
	file: File,
	onProgress?: (percent: number) => void,
	allowReuse = false,
): Promise<AudioCreateResult> {
	onProgress?.(1)
	if (!file) return { success: false, reason: 'No file provided' }
	if (socket.readyState.value !== 'READY') return { success: false, reason: 'Socket not ready' }
	if (!user.value)
		return { success: false, reason: 'User not logged in. Please log in to upload audio files.' }

	if (!audioMimeTypes.includes(file.type)) {
		return { success: false, reason: 'Invalid file type. Please upload valid .mp3 or .wav file.' }
	}

	try {
		const arrayBufPromise = file.arrayBuffer()

		const uploadRequestPromise = socket.emitWithAck('get:upload:url', {
			filename: file.name,
			filetype: file.type,
			filesize: file.size,
		})

		const [arrayBuf, res] = await Promise.all([arrayBufPromise, uploadRequestPromise])

		if (!res.success) {
			return { success: false, reason: res.error.message }
		}

		onProgress?.(5)

		const { url, file_id, color, file_name, file_key } = res.data

		// always copy buffer because decodeAudioData detaches it i think :P
		const audioCtxBuffer = await audioContext.decodeAudioData(arrayBuf.slice(0))

		const duration = audioCtxBuffer.duration
		const sampleRate = audioCtxBuffer.sampleRate

		onProgress?.(15)

		const fileHash = makeAudioFileHash({ duration, file_name, creator_user_id: user.value.id })
		const existing = [...audiofiles.values()].find((f) => f.hash === fileHash)
		if (existing) {
			if (allowReuse) {
				onProgress?.(100)
				return {
					success: true,
					id: existing.id,
					duration: existing.duration,
					uploadPromise: activeUploads.get(existing.id) || Promise.resolve(),
				}
			} else {
				return { success: false, reason: 'File already exists' }
			}
		}

		// Spend 15% -> 30% on peak computation
		const waveforms = await computePeaks(file_id, audioCtxBuffer, color, (p) => {
			onProgress?.(15 + p * 0.15)
		})

		onProgress?.(30)

		// these should be fire and forget and non blocking on main thread ideally
		// should be doable with workers and the new opfs cache
		cacheAudioFile(file_id, file_id, arrayBuf).catch((err) => console.error(err))
		cacheBitmaps(file_id, file_id, waveforms).catch((err) => console.error(err))

		audioBuffers.set(file_id, audioCtxBuffer)

		const optimisticAudioFile: AudioFile = {
			id: file_id,
			file_name,
			public_url: url,
			created_at: new Date().toISOString(),
			color,
			duration,
			waveforms,
			creator_user_id: user.value.id,
			sampleRate,
			// filename here is already sanitized from server res
			hash: makeAudioFileHash({ duration, file_name, creator_user_id: user.value.id }),
		}

		audiofiles.set(file_id, optimisticAudioFile)

		async function backgroundUpload() {
			try {
				// Upload phase: 30% -> 95%
				await uploadFile(url, file, (p) => {
					onProgress?.(30 + p * 0.65)
				})

				const res = await socket.emitWithAck('get:upload:finalize', {
					duration,
					file_key,
				})

				if (!res.success) {
					return handleUploadFailure(file_id, res.error)
				} else {
					onProgress?.(100)
				}

				// nothing to do, server will broadcast audiofile:create event
			} catch (err) {
				handleUploadFailure(file_id, err)
			}
		}

		// we dont await so upload happens in the background
		// but we get early return with optimistic audiofile
		const uploadPromise = backgroundUpload()

		activeUploads.set(file_id, uploadPromise)
		uploadPromise.finally(() => activeUploads.delete(file_id))

		return { success: true, id: file_id, duration, uploadPromise }
	} catch (err) {
		console.error('File upload failed:', err)
		return { success: false, reason: 'Failed to upload file' }
	}
}

function handleUploadFailure(fileId: string, err: unknown) {
	console.error('File upload failed:', err)

	audiofiles.delete(fileId)
	audioBuffers.delete(fileId)

	for (const [clipId, clip] of clips.entries()) {
		if (clip.audio_file_id === fileId) clips.delete(clipId)
	}

	addToast({
		type: 'action_request',
		title: 'File upload failed',
		message: `Please refresh and try uploading the file again. Error: ${typeof err === 'object' && err !== null && 'message' in err ? err.message : 'Unknown error'}`,
		icon: 'warning',
		priority: 'high',
		onConfirm: {
			label: 'Refresh page',
			func: () => {
				window.location.reload()
			},
		},
		onDeny: {
			label: 'Cancel',
			func: ({ id }) => removeToast(id),
		},
	})
}

function uploadFile(
	url: string,
	file: File,
	onProgress?: (percent: number) => void,
): Promise<void> {
	return new Promise((resolve, reject) => {
		const xhr = new XMLHttpRequest()
		xhr.open('PUT', url, true)
		xhr.setRequestHeader('Content-Type', file.type)

		if (xhr.upload && onProgress) {
			xhr.upload.onprogress = (event) => {
				if (!event.lengthComputable) return
				const percentComplete = Math.round((event.loaded / event.total) * 100)
				onProgress(percentComplete)
			}
		}

		xhr.onload = () => {
			if (xhr.status >= 200 && xhr.status < 300) resolve()
			else reject(new Error('Upload failed with status ' + xhr.status))
		}
		xhr.onerror = () => reject(new Error('Network error during upload'))
		xhr.send(file)
	})
}
