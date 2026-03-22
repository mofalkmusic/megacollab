import { clips, audioBuffers, tracks, bpm } from '@/state'
import type { ClipClient, TrackClient } from '~/schema'
import { beats_to_sec_pure } from '@/utils/mathUtils'
import { mutedTrackIds, soloTrackIds } from '@/audioEngine'

export type PlaylistSnapshot = {
	clips: ClipClient[]
	tracks: Map<string, TrackClient>
	buffers: Map<string, AudioBuffer>
	bpm: number
	mutedTrackIds: Set<string>
	soloTrackIds: Set<string>
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
		mutedTrackIds: new Set(mutedTrackIds),
		soloTrackIds: new Set(soloTrackIds),
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
		const isSoloActive = snapshot.soloTrackIds.size > 0
		const isMuted = isSoloActive
			? !snapshot.soloTrackIds.has(trackId)
			: snapshot.mutedTrackIds.has(trackId)

		if (isMuted) continue

		const gainNode = offlineCtx.createGain()
		gainNode.gain.value = track.gain
		gainNode.connect(offlineCtx.destination)
		trackGainNodes.set(trackId, gainNode)
	}

	// Schedule every clip
	for (const clip of snapshot.clips) {
		if (clip.is_muted) continue

		const buffer = snapshot.buffers.get(clip.audio_file_id)
		const trackGainNode = trackGainNodes.get(clip.track_id)
		if (!buffer || !trackGainNode) continue

		const source = offlineCtx.createBufferSource()
		const clipGainNode = offlineCtx.createGain()

		source.buffer = buffer
		source.connect(clipGainNode)
		clipGainNode.connect(trackGainNode)

		const startTimeSec = Math.max(0, beats_to_sec_pure(clip.start_beat, snapshot.bpm))
		const clipDurationSec = Math.max(
			0,
			beats_to_sec_pure(clip.end_beat - clip.start_beat, snapshot.bpm),
		)

		const effectiveGain = clip.gain
		clipGainNode.gain.setValueAtTime(clip.fade_in_sec > 0 ? 0 : effectiveGain, startTimeSec)

		const fadeInEnd = startTimeSec + clip.fade_in_sec
		const fadeOutStart = startTimeSec + clipDurationSec - clip.fade_out_sec
		const fadeOutEnd = startTimeSec + clipDurationSec

		if (clip.fade_in_sec > 0) {
			clipGainNode.gain.linearRampToValueAtTime(effectiveGain, fadeInEnd)
		}

		if (clip.fade_out_sec > 0) {
			if (clip.fade_in_sec <= 0 || fadeOutStart > fadeInEnd) {
				clipGainNode.gain.setValueAtTime(effectiveGain, fadeOutStart)
			}
			clipGainNode.gain.linearRampToValueAtTime(0, fadeOutEnd)
		}

		source.start(startTimeSec, clip.offset_seconds, clipDurationSec)
	}

	return offlineCtx.startRendering()
}
