import { pxPerBeat, bpm } from '@/state'
import type { AudioFile } from '@/types'

export function beats_to_px(beats: number) {
	return beats * pxPerBeat.value
}

export function px_to_beats(px: number) {
	return px / pxPerBeat.value
}

export function sec_to_beats(seconds: number) {
	const beats_per_second = bpm / 60
	return seconds * beats_per_second
}

export function beats_to_sec(beats: number) {
	const seconds_per_beat = 60 / bpm
	return beats * seconds_per_beat
}

export function quantize_beats(beats: number, opts?: { ceil?: boolean }) {
	if (!opts?.ceil) {
		return Math.round(beats)
	}
	return Math.ceil(beats)
}
