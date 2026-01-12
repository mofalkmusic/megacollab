import {
	getAudioFile,
	getBitmaps,
	cacheAudioFile,
	cacheBitmaps,
	computePeaks,
} from '@/utils/workerPool'
import { audioBuffers, audiofiles, clips } from '@/state'
import type { ServerAudioFile, Clip } from '~/schema'
import { audioContext } from '@/audioEngine'
import type { AudioFile, ImageBitmapLODs } from '@/types'

/**
 * fetches and decodes audio buffers
 * spins up worker to create LOD peaks through bitmaps from sharedArraybuffer
 * adds audiobuffer to audiobuffers @/store
 * caches everything in local indexdb
 */
export async function ingestNewAudioFileMetadata(
	allfiles: ServerAudioFile | ServerAudioFile[],
	opts?: { onProgress?: (progress: number) => void; onAllComplete?: () => void },
): Promise<void> {
	const onProgress = opts?.onProgress ?? (() => {})
	const onAllComplete = opts?.onAllComplete ?? (() => {})

	onProgress(5)

	const files = Array.isArray(allfiles) ? allfiles : [allfiles]

	if (files.length === 0) {
		onProgress(100)
		onAllComplete()
		return
	}

	const allFileIds = files.map((file) => file.id)

	const totalCacheOps = allFileIds.length * 2
	let completedCacheOps = 0

	const updateCacheProgress = () => {
		const start = 5
		const end = 40
		const progress = totalCacheOps > 0 ? completedCacheOps / totalCacheOps : 0
		onProgress(Math.round(start + (end - start) * progress))
	}

	// Parallel equivalent of getManyFromCache
	const [cachedBuffers, cachedBitMaps] = await Promise.all([
		// Fetch buffers
		(async () => {
			const map = new Map<string, ArrayBuffer>()
			await Promise.all(
				allFileIds.map(async (id) => {
					const buf = await getAudioFile(id, id)
					if (buf) map.set(id, buf)
					completedCacheOps++
					updateCacheProgress()
				}),
			)
			return map
		})(),
		// Fetch bitmaps
		(async () => {
			const map = new Map<string, ImageBitmapLODs>()
			await Promise.all(
				allFileIds.map(async (id) => {
					const bmp = await getBitmaps(id, id)
					if (bmp) map.set(id, bmp)
					completedCacheOps++
					updateCacheProgress()
				}),
			)
			return map
		})(),
	])

	const filesToFetch = new Set<ServerAudioFile>()
	const filesCached = new Set<ServerAudioFile>()

	for (const file of files) {
		// If we already have the buffer in memory, skip (redundancy check)
		if (audioBuffers.has(file.id) && audiofiles.get(file.id)?.waveforms) {
			continue
		}

		const buf = cachedBuffers.get(file.id)
		if (!buf || !(buf instanceof ArrayBuffer)) {
			filesToFetch.add(file)
			continue
		}

		const waveforms = cachedBitMaps.get(file.id)
		if (!waveforms) {
			filesToFetch.add(file)
			continue
		}

		filesCached.add(file)
	}

	onProgress(40)

	const newArrayBuffers = new Map<string, ArrayBuffer>()
	const newWaveforms = new Map<string, ImageBitmapLODs>()

	// Progress tracking for both new and cached files
	const fetchCompletionMap = new Map<string, number>()
	const cachedCompletionMap = new Map<string, number>()

	const updateCombinedProgress = () => {
		const fetchMax = filesToFetch.size * 100
		const cacheMax = filesCached.size * 100

		let fetchRatio = 1
		if (filesToFetch.size > 0) {
			const current = Array.from(fetchCompletionMap.values()).reduce(
				(acc, val) => acc + val,
				0,
			)
			fetchRatio = current / fetchMax
		}

		let cacheRatio = 1
		if (filesCached.size > 0) {
			const current = Array.from(cachedCompletionMap.values()).reduce(
				(acc, val) => acc + val,
				0,
			)
			cacheRatio = current / cacheMax
		}

		// Fetch phase: 40 -> 80 (40 units)
		// Cache phase: 80 -> 95 (15 units)
		// Base: 40
		const progress = 40 + fetchRatio * 40 + cacheRatio * 15
		onProgress(Math.round(progress))
	}

	// Optimization: Prioritize files used by active clips
	const filesToFetchArr = [...filesToFetch]
	const activeFileIds = new Set<string>()
	for (const clip of clips.values()) {
		activeFileIds.add(clip.audio_file_id)
	}

	filesToFetchArr.sort((a, b) => {
		const aActive = activeFileIds.has(a.id)
		const bActive = activeFileIds.has(b.id)
		if (aActive && !bActive) return -1
		if (!aActive && bActive) return 1
		return 0
	})

	const fetchPromise = Promise.all(
		filesToFetchArr.map(async (file) => {
			try {
				fetchCompletionMap.set(file.id, 0)
				updateCombinedProgress()
				const rawBuffer = await retrieveBufferFetch(file.public_url, (p) => {
					fetchCompletionMap.set(file.id, p / 2)
					updateCombinedProgress()
				})
				newArrayBuffers.set(file.id, rawBuffer)

				const audioBuffer = await audioContext.decodeAudioData(rawBuffer.slice(0)) // needs copy
				// Update State Immediately
				audioBuffers.set(file.id, audioBuffer)

				// could theoretically already add all clips that reference this audiofileid

				fetchCompletionMap.set(file.id, 75)
				updateCombinedProgress()

				const waveforms = await computePeaks(file.id, audioBuffer)
				newWaveforms.set(file.id, waveforms)

				// Update State Immediately
				const existing = audiofiles.get(file.id)
				if (existing) {
					existing.waveforms = waveforms
					existing.sampleRate = audioBuffer.sampleRate
				} else {
					console.error('Cached file not found:', file.id, file.file_name)
				}
			} catch (err) {
				console.error(
					'Failed to fetch or decode buffer or peaks for file:',
					file.id,
					file.file_name,
					err,
				)
				return
			} finally {
				fetchCompletionMap.set(file.id, 100)
				updateCombinedProgress()
			}
		}),
	)

	const cachedPromise = Promise.all(
		[...filesCached].map(async (file) => {
			try {
				cachedCompletionMap.set(file.id, 0)
				updateCombinedProgress()
				const rawBuf = cachedBuffers.get(file.id)!
				const audioBuffer = await audioContext.decodeAudioData(rawBuf.slice(0))

				// Update State
				audioBuffers.set(file.id, audioBuffer)

				// could theoretically already add all clips that reference this audiofileid

				const waveforms = cachedBitMaps.get(file.id)!
				const existing = audiofiles.get(file.id)
				if (existing) {
					existing.waveforms = waveforms
					existing.sampleRate = audioBuffer.sampleRate
				} else {
					console.error('Cached file not found 2:', file.id, file.file_name)
				}
			} catch (err) {
				console.error(
					'Failed to decode cached buffer for file:',
					file.id,
					file.file_name,
					err,
				)
				return
			} finally {
				cachedCompletionMap.set(file.id, 100)
				updateCombinedProgress()
			}
		}),
	)

	await Promise.all([fetchPromise, cachedPromise])

	onProgress(98)

	// Fire and forget cache saves
	if (newArrayBuffers.size > 0) {
		for (const [key, data] of newArrayBuffers) {
			cacheAudioFile(key, key, data).catch((err) =>
				console.error('Failed to save audio buffer to cache:', err),
			)
		}
	}

	if (newWaveforms.size > 0) {
		for (const [key, data] of newWaveforms) {
			cacheBitmaps(key, key, data).catch((err) =>
				console.error('Failed to save bitmaps to cache:', err),
			)
		}
	}

	onProgress(100)
	onAllComplete()
}

async function retrieveBufferFetch(
	url: string,
	onProgress: (progress: number) => void,
): Promise<ArrayBuffer> {
	const res = await fetch(url)
	if (!res.ok) throw new Error(`Failed to load audio: ${res.statusText}`)

	const contentLength = res.headers.get('content-length')
	const total = contentLength ? parseInt(contentLength, 10) : 0

	if (!total || !res.body) {
		onProgress(50) // Indeterminate
		return await res.arrayBuffer()
	}

	const reader = res.body.getReader()
	const chunks: Uint8Array[] = []
	let receivedLength = 0

	while (true) {
		const { done, value } = await reader.read()
		if (done) break
		if (value) {
			chunks.push(value)
			receivedLength += value.length
			onProgress((receivedLength / total) * 100)
		}
	}

	const result = new Uint8Array(receivedLength)
	let position = 0
	for (const chunk of chunks) {
		result.set(chunk, position)
		position += chunk.length
	}

	return result.buffer
}
