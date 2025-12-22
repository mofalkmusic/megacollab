import { computed, shallowRef, watch } from 'vue'
import { beats_to_sec, quantize_beats } from '@/utils/mathUtils'
import { useIntervalFn, useRafFn, watchThrottled } from '@vueuse/core'
import { clips, TOTAL_BEATS, audioBuffers } from '@/state'
import type { Clip, ServerTrack } from '~/schema'

const inDev = import.meta.env.MODE === 'development'

export const audioContext = new AudioContext()
const masterGain = audioContext.createGain()
masterGain.connect(audioContext.destination)

const trackGainNodes = new Map<string, GainNode>()

const SCHEDULER_LOOP_INRERVAL_MS = 25 as const

export const isPlaying = shallowRef(false)
const playbackStartTime = shallowRef(0)
const startOffset = shallowRef(0)
export const currentTime = shallowRef(0)
const playId = shallowRef<symbol>(Symbol())

const nextScheduleTime = shallowRef(0)
type ActiveWrapper = { source: AudioBufferSourceNode; hash: string; gainNode?: GainNode }
const activeSources = new Map<string, ActiveWrapper>()
const scheduledClipIds = new Set<string>()
export const restingPositionSec = shallowRef(0)

const loopStartBeat = shallowRef<number | null>(null)
const loopEndBeat = shallowRef<number | null>(null)

export const loopRangeBeats = computed(() => {
	if (loopStartBeat.value == null || loopEndBeat.value == null) return null
	const start = Math.min(loopStartBeat.value, loopEndBeat.value)
	const end = Math.max(loopStartBeat.value, loopEndBeat.value)
	return { start, end }
})

function getClipHash(clip: Clip): string {
	return `${clip.start_beat}:${clip.end_beat}:${clip.offset_seconds}:${clip.audio_file_id}:${clip.track_id}`
}

function stopSource(sourceWrapper: { source: AudioBufferSourceNode }) {
	try {
		sourceWrapper.source.stop()
	} catch (e) {
		if (inDev) console.error(e)
	}
}

function dbToLinear(db: number) {
	return Math.pow(10, db / 20)
}

function reconcileActiveSources() {
	if (!isPlaying.value) return

	for (const [clipId, wrapper] of activeSources.entries()) {
		const clip = clips.get(clipId)

		if (!clip) {
			stopSource(wrapper)
			activeSources.delete(clipId)
			continue
		}

		const currentHash = getClipHash(clip)
		if (currentHash !== wrapper.hash) {
			stopSource(wrapper)
			activeSources.delete(clipId)
		}
	}

	const elapsedSeconds = audioContext.currentTime - playbackStartTime.value
	const currentSongTime = startOffset.value + elapsedSeconds

	for (const clip of clips.values()) {
		if (activeSources.has(clip.id)) continue

		const clipStartSeconds = beats_to_sec(clip.start_beat)
		const clipEndSeconds = beats_to_sec(clip.end_beat)

		const buffer = audioBuffers.get(clip.audio_file_id)
		const trackGainNode = trackGainNodes.get(clip.track_id)
		if (!buffer || !trackGainNode) continue

		if (currentSongTime >= clipStartSeconds && currentSongTime < clipEndSeconds) {
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

export const playheadSec = shallowRef(0)
export const playheadPx = shallowRef(0)

export const fullDurationSeconds = computed(() => {
	return beats_to_sec(TOTAL_BEATS)
})

export function setLoopInBeats(start_beats: number, end_beats: number) {
	const quantizedStart = quantize_beats(start_beats)
	const quantizedEnd = quantize_beats(end_beats, { ceil: true })
	loopStartBeat.value = Math.min(quantizedStart, quantizedEnd)
	loopEndBeat.value = Math.max(quantizedStart, quantizedEnd)
}

export function clearLoop() {
	loopStartBeat.value = null
	loopEndBeat.value = null
}

export function registerTrack(trackId: ServerTrack['id']) {
	if (trackGainNodes.has(trackId)) return

	const gainNode = audioContext.createGain()
	gainNode.connect(masterGain)

	gainNode.gain.value = 1
	trackGainNodes.set(trackId, gainNode)
}

export function unregisterTrack(trackId: ServerTrack['id']) {
	const gainNode = trackGainNodes.get(trackId)
	if (!gainNode) return

	gainNode.disconnect()
	trackGainNodes.delete(trackId)
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
		const lookAheadLimitSec = songTimeSeconds + SCHEDULER_LOOP_INRERVAL_MS * 3

		for (const clip of clips.values()) {
			if (activeSources.has(clip.id)) continue

			const clipStartSeconds = beats_to_sec(clip.start_beat)

			if (clipStartSeconds > songTimeSeconds && clipStartSeconds <= lookAheadLimitSec) {
				scheduleClipSource(clip, clipStartSeconds)
			}
		}

		nextScheduleTime.value = lookAheadLimitSec

		if (songTimeSeconds > fullDurationSeconds.value) {
			seek(0)
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
	source.buffer = buffer

	const clipGainNode = audioContext.createGain();
	let linear = 1; // ts (slang for this) prioritiestize clip.gain over clip.gain_db 
	if (typeof clip.gain === 'number') {
		linear = clip.gain;
	} else if (typeof clip.gain_db === 'number') {
		linear = dbToLinear(clip.gain_db);
	}
	clipGainNode.gain.value = linear

	source.connect(clipGainNode)
	clipGainNode.connect(trackGainNode)

	const whenToPlay = playbackStartTime.value + (whenAbsoluteSeconds - startOffset.value)
	let offsetSeconds = 0
	let playAt = whenToPlay

	const now = audioContext.currentTime

	if (playAt < now) {
		const timeMissed = now - playAt
		offsetSeconds = timeMissed
		playAt = now
	}

	const finalOffset = clip.offset_seconds + offsetSeconds
	const durationSeconds = beats_to_sec(clip.end_beat - clip.start_beat) - offsetSeconds

	if (durationSeconds <= 0) return

	source.start(playAt, finalOffset, durationSeconds)

	const hash = getClipHash(clip)
	const wrapper: ActiveWrapper = { source, hash, gainNode: clipGainNode }
	activeSources.set(clip.id, wrapper)

	const sessionId = playId.value

	source.onended = () => {
		if (playId.value !== sessionId) return
		const active = activeSources.get(clip.id)
		if (active && active.source === source) {
			activeSources.delete(clip.id)
		}
	}
}

function scheduleInitialClips(startTimeSeconds: number) {
	for (const clip of clips.values()) {
		const clipStartSeconds = beats_to_sec(clip.start_beat)
		const clipEndSeconds = beats_to_sec(clip.end_beat)

		if (clipStartSeconds > startTimeSeconds) continue
		if (clipEndSeconds < startTimeSeconds) continue

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

	playbackStartTime.value = audioContext.currentTime + 0.05
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
	playbackStartTime.value = audioContext.currentTime + 0.05
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

watchThrottled(
	clips,
	() => {
		for (const [clipId, wrapper] of activeSources.entries()) {
			const clip = clips.get(clipId)
			if (!clip || !wrapper.gainNode) continue
			const targetLinear = typeof clip.gain === 'number' ? clip.gain : (typeof clip.gain_db === 'number' ? dbToLinear(clip.gain_db) : 1)
			const current = wrapper.gainNode.gain.value
			if (Math.abs(current - targetLinear) > 0.0001) {
				wrapper.gainNode.gain.setTargetAtTime(targetLinear, audioContext.currentTime, 0.01)
			}
		}
	},
	{ throttle: 50 },
)
