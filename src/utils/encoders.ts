import { Mp3Encoder } from '@breezystack/lamejs'

const LAME_ENCODER_DELAY = 1152 as const

export function encodeWav(buffer: AudioBuffer, onProgress?: (pct: number) => void): Blob {
	const numChannels = buffer.numberOfChannels
	const sampleRate = buffer.sampleRate
	const totalSamples = buffer.length
	const bytesPerSample = 4 // 32-bit float
	const dataLength = totalSamples * numChannels * bytesPerSample

	// WAV header (44 bytes)
	const headerBuffer = new ArrayBuffer(44)
	const view = new DataView(headerBuffer)

	// RIFF chunk
	writeString(view, 0, 'RIFF')
	view.setUint32(4, 36 + dataLength, true)
	writeString(view, 8, 'WAVE')

	// fmt sub-chunk
	writeString(view, 12, 'fmt ')
	view.setUint32(16, 16, true) // sub-chunk size
	view.setUint16(20, 3, true) // IEEE float format
	view.setUint16(22, numChannels, true)
	view.setUint32(24, sampleRate, true)
	view.setUint32(28, sampleRate * numChannels * bytesPerSample, true) // byte rate
	view.setUint16(32, numChannels * bytesPerSample, true) // block align
	view.setUint16(34, bytesPerSample * 8, true) // bits per sample

	// data sub-chunk
	writeString(view, 36, 'data')
	view.setUint32(40, dataLength, true)

	// Interleave float samples directly (no clamping — preserves above-0dBFS)
	const channels: Float32Array[] = []
	for (let ch = 0; ch < numChannels; ch++) {
		channels.push(buffer.getChannelData(ch))
	}

	const pcmData = new Float32Array(totalSamples * numChannels)
	const CHUNK_SIZE = 8192

	for (let i = 0; i < totalSamples; i += CHUNK_SIZE) {
		const end = Math.min(i + CHUNK_SIZE, totalSamples)
		for (let s = i; s < end; s++) {
			for (let ch = 0; ch < numChannels; ch++) {
				pcmData[s * numChannels + ch] = channels[ch]![s]!
			}
		}

		if (onProgress) {
			onProgress(Math.round((end / totalSamples) * 100))
		}
	}

	return new Blob([headerBuffer, pcmData.buffer], { type: 'audio/wav' })
}

function writeString(view: DataView, offset: number, str: string) {
	for (let i = 0; i < str.length; i++) {
		view.setUint8(offset + i, str.charCodeAt(i))
	}
}

/**
 * Encode an AudioBuffer as an MP3 Blob using lamejs.
 * Async — yields to the browser every x samples to unblock main thread.
 */
export async function encodeMp3(
	buffer: AudioBuffer,
	onProgress?: (pct: number) => void,
): Promise<Blob> {
	const numChannels = Math.min(buffer.numberOfChannels, 2) as 1 | 2
	const sampleRate = buffer.sampleRate
	const kbps = 320
	const encoder = new Mp3Encoder(numChannels, sampleRate, kbps)

	const leftRaw = floatTo16BitPCM(buffer.getChannelData(0))
	const rightRaw = numChannels === 2 ? floatTo16BitPCM(buffer.getChannelData(1)) : undefined

	// Trim encoder delay so the decoded MP3 doesn't start with silence
	const left = leftRaw.subarray(LAME_ENCODER_DELAY)
	const right = rightRaw?.subarray(LAME_ENCODER_DELAY)

	const mp3Chunks: Uint8Array[] = []
	const SAMPLES_PER_FRAME = 1152
	const YIELD_EVERY_SAMPLES = 50_000
	const totalSamples = left.length
	let samplesSinceYield = 0

	for (let i = 0; i < totalSamples; i += SAMPLES_PER_FRAME) {
		const leftChunk = left.subarray(i, i + SAMPLES_PER_FRAME)
		const rightChunk = right?.subarray(i, i + SAMPLES_PER_FRAME)

		const mp3buf = encoder.encodeBuffer(leftChunk, rightChunk)
		if (mp3buf.length > 0) {
			mp3Chunks.push(mp3buf)
		}

		samplesSinceYield += SAMPLES_PER_FRAME

		if (samplesSinceYield >= YIELD_EVERY_SAMPLES) {
			samplesSinceYield = 0
			if (onProgress) {
				onProgress(
					Math.round(
						(Math.min(i + SAMPLES_PER_FRAME, totalSamples) / totalSamples) * 100,
					),
				)
			}
			// Yield to browser so progress bar can repaint
			await new Promise<void>((r) => setTimeout(r, 0))
		}
	}

	const finalBuf = encoder.flush()
	if (finalBuf.length > 0) {
		mp3Chunks.push(finalBuf)
	}

	return new Blob(mp3Chunks as BlobPart[], { type: 'audio/mpeg' })
}

function floatTo16BitPCM(float32: Float32Array): Int16Array {
	const int16 = new Int16Array(float32.length)
	for (let i = 0; i < float32.length; i++) {
		const s = Math.max(-1, Math.min(1, float32[i]!))
		int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff
	}
	return int16
}
