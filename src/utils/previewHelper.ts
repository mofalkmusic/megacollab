import { audioContext, masterGainNode } from '@/audioEngine'
import { audioBuffers, poolPreviewPlayingAudioId } from '@/state'

let source: AudioBufferSourceNode | null = null
let startTime = 0
let audioBuffer: AudioBuffer | null = null

export function playPreview(id: string) {
	stopPreview()
	const buffer = audioBuffers.get(id)

	if (!buffer) return

	audioBuffer = buffer

	const currentSource = audioContext.createBufferSource()
	source = currentSource

	source.buffer = audioBuffer
	source.connect(masterGainNode)

	startTime = audioContext.currentTime
	source.start()

	poolPreviewPlayingAudioId.value = id

	currentSource.onended = () => {
		if (source === currentSource) {
			source = null
			poolPreviewPlayingAudioId.value = null
		}
	}
}

export function stopPreview() {
	poolPreviewPlayingAudioId.value = null
	if (!source) return

	source.stop()
	source = null
}

export function getPreviewProgress() {
	if (!audioBuffer) return 0
	if (!source) return 0

	const duration = audioBuffer.duration
	const time = audioContext.currentTime - startTime

	const progress = time / duration
	if (Number.isNaN(progress)) return 0

	return Math.max(0, Math.min(progress, 1))
}
