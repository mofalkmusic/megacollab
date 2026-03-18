import { clips, audioBuffers, tracks, bpm } from '@/state'
import type { ClipClient, TrackClient } from '~/schema'
import { beats_to_sec_pure } from '@/utils/mathUtils'

export type PlaylistSnapshot = {
	clips: ClipClient[]
	tracks: Map<string, TrackClient>
	buffers: Map<string, AudioBuffer>
	bpm: number
}

/**
 * Capture a frozen snapshot of the current playlist state.
 * Deep-clones clips and tracks (plain objects).
 * Shallow-copies the audioBuffers Map — AudioBuffer objects are immutable,
 * so the snapshot's reference keeps them alive even if deleted from state mid-render.
 */
function takeSnapshot(): PlaylistSnapshot {
	const clipsSnapshot = Array.from(clips.values()).map((c) => ({ ...c }))
	const tracksSnapshot = new Map(Array.from(tracks.entries()).map(([id, t]) => [id, { ...t }]))
	const buffersSnapshot = new Map(audioBuffers)

	return {
		clips: clipsSnapshot,
		tracks: tracksSnapshot,
		buffers: buffersSnapshot,
		bpm,
	}
}

const SAMPLE_RATE = 44100
const NUM_CHANNELS = 2

/**
 * Render the current playlist state offline using OfflineAudioContext.
 * Returns a rendered AudioBuffer ready for encoding.
 */
export async function renderPlaylistOffline(): Promise<AudioBuffer> {
	const snapshot = takeSnapshot()

	if (snapshot.clips.length === 0) {
		throw new Error('No clips to render')
	}

	// Find the latest end beat to determine render duration
	let latestEndBeat = 0
	for (const clip of snapshot.clips) {
		if (clip.end_beat > latestEndBeat) latestEndBeat = clip.end_beat
	}

	const durationSeconds = beats_to_sec_pure(latestEndBeat, snapshot.bpm)
	if (durationSeconds <= 0) {
		throw new Error('Playlist has zero duration')
	}

	const offlineCtx = new OfflineAudioContext(
		NUM_CHANNELS,
		Math.ceil(durationSeconds * SAMPLE_RATE),
		SAMPLE_RATE,
	)

	// Build per-track gain nodes → destination
	const trackGainNodes = new Map<string, GainNode>()
	for (const [trackId, track] of snapshot.tracks) {
		const gainNode = offlineCtx.createGain()
		gainNode.gain.value = track.gain
		gainNode.connect(offlineCtx.destination)
		trackGainNodes.set(trackId, gainNode)
	}

	// Schedule every clip
	for (const clip of snapshot.clips) {
		const buffer = snapshot.buffers.get(clip.audio_file_id)
		const trackGainNode = trackGainNodes.get(clip.track_id)
		if (!buffer || !trackGainNode) continue

		const source = offlineCtx.createBufferSource()
		const clipGainNode = offlineCtx.createGain()

		clipGainNode.gain.value = clip.gain
		source.buffer = buffer
		source.connect(clipGainNode)
		clipGainNode.connect(trackGainNode)

		const startTimeSec = beats_to_sec_pure(clip.start_beat, snapshot.bpm)
		const clipDurationSec = beats_to_sec_pure(clip.end_beat - clip.start_beat, snapshot.bpm)

		source.start(startTimeSec, clip.offset_seconds, clipDurationSec)
	}

	return offlineCtx.startRendering()
}
