import { audioContext } from '@/audioEngine'
import { audioBuffers, previewPlaying } from '@/state'

let source: AudioBufferSourceNode | null = null
let startTime = 0
let buf: AudioBuffer | null = null

export function playPreview(id: string) {
	stopPreview()
	const buffer = audioBuffers.get(id)

	if (!buffer) return

	buf = buffer

	source = audioContext.createBufferSource()
	source.buffer = buf
	source.connect(audioContext.destination)

	startTime = audioContext.currentTime
	source.start()

	previewPlaying.value = id

	source.onended = () => {
		source = null
		previewPlaying.value = null
	}
}

export function stopPreview() {
	previewPlaying.value = null
	if (!source) return

	source.stop()
	source = null
}

export function getPreviewProgress() {
	if (!buf) return 0
	if (!source) return 0

	const duration = buf.duration
	const time = audioContext.currentTime - startTime

	return Math.min(time / duration, 1)
}
