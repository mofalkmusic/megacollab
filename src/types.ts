import type { ClientAudioFile } from '~/schema'

export type ImageBitmapLODs = {
	[samplesPerPeak: number]: ImageBitmap
}

export type BitmapLODs = {
	audioFileId: string
	resolutions: ImageBitmapLODs
}

export type AudioFile = ClientAudioFile & {
	hash: string
	sampleRate?: number
	waveforms?: ImageBitmapLODs
}
