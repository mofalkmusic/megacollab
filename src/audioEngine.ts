import { computed, shallowRef, watch } from 'vue'
import { beats_to_sec, quantize_beats, sec_to_beats } from '@/utils/mathUtils'
import { useIntervalFn, useRafFn, watchThrottled } from '@vueuse/core'
import { clips, TOTAL_BEATS, audioBuffers, bpm } from '@/state'
import type { Clip, ServerTrack } from '~/schema'

// this is very hacked together, some ai stuff here aswell :D
// gotta clean this up when i get the time

const inDev = import.meta.env.MODE === 'development'

export const audioContext = new AudioContext()
const masterGain = audioContext.createGain()
masterGain.connect(audioContext.destination)

const trackGainNodes = new Map<string, GainNode>()
const trackAnalysers = new Map<string, AnalyserNode>()

const SCHEDULER_LOOP_INRERVAL_MS = 100 as const
const FFT_SIZE_VOLUMES = 256 as const
const BACK_TRACKING_TIME_ON_PLAY = 0.05 as const

const sortedClips = computed(() => {
	return Array.from(clips.values()).sort((a, b) => a.start_beat - b.start_beat)
})

const maxClipDuration = computed(() => {
	let max = 0
	for (const clip of clips.values()) {
		const duration = clip.end_beat - clip.start_beat
		if (duration > max) max = duration
	}
	return max
})

// Playback State
export const isPlaying = shallowRef(false)
const playbackStartTime = shallowRef(0) // The timestamp in the AudioContext (hardware clock) when you hit "Play".
const startOffset = shallowRef(0) // The position in the Song (e.g., 10 seconds in) where the Playhead was located when you hit "Play".
export const currentTime = shallowRef(0)
const playId = shallowRef<symbol>(Symbol())

const nextScheduleTime = shallowRef(0)
const activeSources = new Map<
	string,
	{ source: AudioBufferSourceNode; gainNode: GainNode; hash: string }
>()
const scheduledClipIds = new Set<string>() // kept for loop lookahead optimization if needed, but might be redundant with activeSources check
export const restingPositionSec = shallowRef(0)

// Loop State
// Loop State
export const isLooping = shallowRef(false)
const loopStartBeat = shallowRef<number | null>(4)
const loopEndBeat = shallowRef<number | null>(8)

export const loopRangeBeats = computed(() => {
	if (loopStartBeat.value == null || loopEndBeat.value == null) return null
	const start = Math.min(loopStartBeat.value, loopEndBeat.value)
	const end = Math.max(loopStartBeat.value, loopEndBeat.value)
	return { start, end }
})

function getClipHash(clip: Clip): string {
	return `${clip.start_beat}:${clip.end_beat}:${clip.offset_seconds}:${clip.audio_file_id}:${clip.track_id}:${clip.gain}`
}

function stopSource(sourceWrapper: { source: AudioBufferSourceNode; gainNode: GainNode }) {
	try {
		sourceWrapper.source.stop()
		sourceWrapper.source.disconnect()
		sourceWrapper.gainNode.disconnect()
	} catch (e) {
		if (inDev) console.error(e)
	}
}

function reconcileActiveSources() {
	if (!isPlaying.value) return

	for (const [clipId, wrapper] of activeSources.entries()) {
		const clip = clips.get(clipId)

		// Clip deleted
		if (!clip) {
			stopSource(wrapper)
			activeSources.delete(clipId)
			continue
		}

		// Clip changed (hash mismatch)
		const currentHash = getClipHash(clip)
		if (currentHash !== wrapper.hash) {
			stopSource(wrapper)
			activeSources.delete(clipId)
			// It will be re-scheduled in the next step if valid
		}
	}

	const elapsedSeconds = audioContext.currentTime - playbackStartTime.value
	const currentSongTime = startOffset.value + elapsedSeconds

	// We look a bit ahead to catch clips starting very soon, but mostly for "now"
	// use a small lookahead for immediate reaction, schedulerLoop handles the future.
	// For immediate user interaction (drag/drop), we want to start NOW if we are "in" the clip.

	// Check all clips to see if they should be playing NOW and aren't.
	// This looks O(N) but N is small (number of clips).

	for (const clip of clips.values()) {
		if (activeSources.has(clip.id)) continue

		const clipStartSeconds = beats_to_sec(clip.start_beat)
		const clipEndSeconds = beats_to_sec(clip.end_beat)

		// Check availability
		const buffer = audioBuffers.get(clip.audio_file_id)
		const trackGainNode = trackGainNodes.get(clip.track_id)
		if (!buffer || !trackGainNode) continue

		// If the clip is "playing right now":
		// start <= current < end
		if (currentSongTime >= clipStartSeconds && currentSongTime < clipEndSeconds) {
			// Schedule it!
			// We need to calculate correct offset.

			scheduleClipSource(clip, clipStartSeconds)
		}
	}
}

watchThrottled(
	clips,
	() => {
		reconcileActiveSources()
	},
	{ deep: true, throttle: 16 },
)

watch(audioBuffers, () => {
	reconcileActiveSources()
})

export const currentPlayTimeSeconds = shallowRef<number>(0)
export const currentPlayTimeBeats = computed(() => sec_to_beats(currentPlayTimeSeconds.value))

watchThrottled(
	[isPlaying, currentTime, restingPositionSec, () => bpm],
	() => {
		currentPlayTimeSeconds.value = isPlaying.value
			? currentTime.value
			: restingPositionSec.value
	},
	{ throttle: 64, immediate: false },
)

export const playheadSec = shallowRef(0)
export const playheadPx = shallowRef(0)

export const fullDurationSeconds = computed(() => {
	return beats_to_sec(TOTAL_BEATS)
})

export function setLoopInBeats(
	start_beats: number,
	end_beats: number,
	opts: { quantize?: boolean } = {},
) {
	const { quantize = true } = opts
	const s = quantize ? quantize_beats(start_beats) : start_beats
	const e = quantize ? quantize_beats(end_beats, { ceil: true }) : end_beats

	loopStartBeat.value = Math.min(s, e)
	loopEndBeat.value = Math.max(s, e)
}

export function clearLoop() {
	loopStartBeat.value = null
	loopEndBeat.value = null
	isLooping.value = false
}

export function toggleLoop() {
	if (isLooping.value) {
		isLooping.value = false
	} else {
		if (loopStartBeat.value == null || loopEndBeat.value == null) {
			loopStartBeat.value = 0
			loopEndBeat.value = 16
		}
		isLooping.value = true
	}
}

export function registerTrack(trackId: ServerTrack['id'], initialGain: number = 1) {
	if (trackGainNodes.has(trackId)) return

	const gainNode = audioContext.createGain()
	gainNode.connect(masterGain)

	gainNode.gain.value = initialGain
	trackGainNodes.set(trackId, gainNode)

	// sidechained vol analyser
	const analyser = audioContext.createAnalyser()
	analyser.fftSize = FFT_SIZE_VOLUMES
	gainNode.connect(analyser) // connect post-gain
	trackAnalysers.set(trackId, analyser)
}

export function setTrackGain(trackId: ServerTrack['id'], gain: number) {
	const gainNode = trackGainNodes.get(trackId)
	if (!gainNode) return

	// ramp to prevent clicks
	const now = audioContext.currentTime
	gainNode.gain.setTargetAtTime(gain, now, 0.02)
}

export function unregisterTrack(trackId: ServerTrack['id']) {
	const gainNode = trackGainNodes.get(trackId)
	if (!gainNode) return

	gainNode.disconnect()
	trackGainNodes.delete(trackId)

	const analyser = trackAnalysers.get(trackId)
	if (analyser) {
		analyser.disconnect()
		trackAnalysers.delete(trackId)
	}
}

const floatBuffer = new Float32Array(FFT_SIZE_VOLUMES)

export function getTrackVolume(trackId: ServerTrack['id']): number {
	const analyser = trackAnalysers.get(trackId)
	if (!analyser) return 0

	analyser.getFloatTimeDomainData(floatBuffer)

	// find peak amplitude
	let max = 0
	let rms = 0
	for (let i = 0; i < floatBuffer.length; i++) {
		const val = floatBuffer[i] ?? 0
		if (Math.abs(val) > max) max = Math.abs(val)
		rms += val * val
	}

	rms = Math.sqrt(rms / floatBuffer.length)

	return max
}

const uiRAFLoop = useRafFn(
	() => {
		if (!isPlaying.value) return
		const elapsed = audioContext.currentTime - playbackStartTime.value
		currentTime.value = startOffset.value + elapsed
	},
	{ immediate: false, fpsLimit: 120 },
)

const schedulerLoop = useIntervalFn(
	() => {
		const elapsedSeconds = audioContext.currentTime - playbackStartTime.value
		const songTimeSeconds = elapsedSeconds + startOffset.value
		const songTimeBeats = sec_to_beats(songTimeSeconds)

		const lookAheadLimitSec = songTimeSeconds + SCHEDULER_LOOP_INRERVAL_MS * 5

		const list = sortedClips.value
		const startIndex = binarySearchStartTimesStartIndex(list, songTimeBeats)

		for (let i = startIndex; i < list.length; i++) {
			const clip = list[i]
			if (!clip) continue

			const clipStartSeconds = beats_to_sec(clip.start_beat)
			if (clipStartSeconds > lookAheadLimitSec) break

			if (activeSources.has(clip.id)) continue
			scheduleClipSource(clip, clipStartSeconds)
		}

		nextScheduleTime.value = lookAheadLimitSec

		const loopStartSec = loopRangeBeats.value ? beats_to_sec(loopRangeBeats.value.start) : 0
		const loopEndSec = loopRangeBeats.value
			? beats_to_sec(loopRangeBeats.value.end)
			: fullDurationSeconds.value

		const loopActive =
			isLooping.value && loopRangeBeats.value != null && loopEndSec > loopStartSec

		// todo: this should perhaps predict the loop and do negative overshooting,
		// but for now its fine

		if (loopActive) {
			// need the actual hardware songTimeSeconds to calculate overshoot
			if (songTimeSeconds >= loopEndSec) {
				const overshoot = songTimeSeconds - loopEndSec
				seek(loopStartSec + overshoot, { setAsRest: false })
				return
			}
		} else if (songTimeSeconds >= fullDurationSeconds.value) {
			const overshoot = songTimeSeconds - fullDurationSeconds.value
			seek(0 + overshoot, { setAsRest: false })
		}
	},
	SCHEDULER_LOOP_INRERVAL_MS,
	{
		immediate: false,
	},
)

function scheduleClipSource(clip: Clip, whenAbsoluteSeconds: number) {
	const buffer = audioBuffers.get(clip.audio_file_id)
	const trackGainNode = trackGainNodes.get(clip.track_id)

	if (!buffer || !trackGainNode) return

	const source = audioContext.createBufferSource()
	const clipGainNode = audioContext.createGain()

	clipGainNode.gain.value = clip.gain

	source.buffer = buffer
	source.connect(clipGainNode)
	clipGainNode.connect(trackGainNode)

	const whenToPlay = playbackStartTime.value + (whenAbsoluteSeconds - startOffset.value)
	// IMPORTANT: start() time parameter is in AudioContext time.
	// whenAbsoluteSeconds is Song time.

	let offsetSeconds = 0
	let playAt = whenToPlay

	const now = audioContext.currentTime

	if (playAt < now) {
		// It should have started in the past.
		// Calculate how far into the clip we are.
		// whenAbsoluteSeconds is where the clip starts in song time.
		// whenToPlay is that song-start-time mapped to context time.

		const timeMissed = now - playAt
		offsetSeconds = timeMissed
		playAt = now
	}

	// Add clip's own internal offset (trimming)
	const finalOffset = clip.offset_seconds + offsetSeconds
	const durationSeconds = beats_to_sec(clip.end_beat - clip.start_beat) - offsetSeconds

	if (durationSeconds <= 0) return // playing end of clip?

	source.start(playAt, finalOffset, durationSeconds)

	const hash = getClipHash(clip)
	const wrapper = { source, gainNode: clipGainNode, hash }
	activeSources.set(clip.id, wrapper)

	const sessionId = playId.value

	source.onended = () => {
		if (playId.value !== sessionId) return

		// Only delete if THIS wrapper is the one currently stored
		// This prevents race condition where immediate rescheduling (synchronous)
		// is wiped out by the async onended of the previous source
		const active = activeSources.get(clip.id)
		if (active && active.source === source) {
			activeSources.delete(clip.id)
			clipGainNode.disconnect()
		}
	}
}

function scheduleInitialClips(startTimeSeconds: number) {
	const startTimeBeats = sec_to_beats(startTimeSeconds)
	const list = sortedClips.value

	// start searching at current pos - longest clip duration backwards to save resources.

	const searchStartBeats = Math.max(0, startTimeBeats - maxClipDuration.value)
	const startIndex = binarySearchStartTimesStartIndex(list, searchStartBeats)

	for (let i = startIndex; i < list.length; i++) {
		const clip = list[i]
		if (!clip) continue

		// clip starts in future?
		// -> scheduler will handle it
		if (clip.start_beat > startTimeBeats) break

		const clipStartSeconds = beats_to_sec(clip.start_beat)
		const clipEndSeconds = beats_to_sec(clip.end_beat)

		// clip ended in past?
		// -> ignore
		if (clipEndSeconds < startTimeSeconds) continue

		// -> clip must be overlapping current time.
		scheduleClipSource(clip, clipStartSeconds)
	}
}

function stopAllSources() {
	playId.value = Symbol()

	for (const wrapper of activeSources.values()) {
		stopSource(wrapper)
	}
	activeSources.clear()
	scheduledClipIds.clear()
}

export async function play() {
	if (isPlaying.value) return

	if (audioContext.state === 'suspended') await audioContext.resume()

	playbackStartTime.value = audioContext.currentTime + BACK_TRACKING_TIME_ON_PLAY
	startOffset.value = restingPositionSec.value

	nextScheduleTime.value = startOffset.value

	scheduleInitialClips(startOffset.value)
	isPlaying.value = true
	schedulerLoop.resume()
	uiRAFLoop.resume()
}

export function pause() {
	if (!isPlaying.value) return

	stopAllSources()

	startOffset.value = restingPositionSec.value
	currentTime.value = restingPositionSec.value
	isPlaying.value = false

	schedulerLoop.pause()
	uiRAFLoop.pause()
}

export function seek(newTimeSeconds: number, opts?: { setAsRest?: boolean }) {
	const defaults = { setAsRest: false }
	const options = { ...defaults, ...opts }

	// todo: make sure that after loop end, is clipped somehow not to play after the  loop pos kinda
	const targetSeconds = Math.max(0, newTimeSeconds)

	if (options.setAsRest) {
		restingPositionSec.value = targetSeconds
	}

	if (!isPlaying.value) {
		startOffset.value = targetSeconds
		currentTime.value = targetSeconds
		return
	}

	stopAllSources()
	playbackStartTime.value = audioContext.currentTime + BACK_TRACKING_TIME_ON_PLAY
	startOffset.value = targetSeconds
	currentTime.value = targetSeconds
	nextScheduleTime.value = targetSeconds

	scheduleInitialClips(targetSeconds)
}

export function reset() {
	if (isPlaying.value) {
		stopAllSources()
		isPlaying.value = false
	}

	currentTime.value = 0
	startOffset.value = 0
	restingPositionSec.value = 0
	playbackStartTime.value = audioContext.currentTime
	nextScheduleTime.value = 0

	playheadPx.value = 0
	playheadSec.value = 0

	schedulerLoop.pause()
	uiRAFLoop.pause()
}

function binarySearchStartTimesStartIndex(sortedClips: Clip[], searchBeat: Clip['start_beat']) {
	let left: number = 0
	let right: number = sortedClips.length - 1

	while (left <= right) {
		const mid = (left + right) >>> 1 // Unsigned right shift: equivalent to Math.floor((left + right) / 2)

		if (sortedClips[mid]!.start_beat < searchBeat) {
			left = mid + 1
		} else {
			right = mid - 1
		}
	}

	// could store lastStartIndex, bc playhead only ever moves rightwards in time.
	// but this optimisation is not needed for now.

	return left
}
