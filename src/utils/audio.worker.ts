import type { ImageBitmapLODs } from '@/types'
import type { WorkerMessage, WorkerResponse } from '@/utils/workerPool'
import { converter, parse } from 'culori'
const SAMPLES_PER_PEAK = [256, 512, 1024, 2048, 4096] as const // Block sizes for peak generation / samples per peak

let opfsRoot: FileSystemDirectoryHandle | null = null

async function getOpfsRoot() {
	if (!opfsRoot) {
		opfsRoot = await navigator.storage.getDirectory()
	}
	return opfsRoot
}

// bump on implementation change
const BITMAP_VERISON = 2 as const

const toRgb = converter('rgb')

function hexToRgb(hex: string): [number, number, number] {
	const parsed = parse(hex)
	if (!parsed) return [255, 255, 255]
	const rgb = toRgb(parsed)
	return [Math.round(rgb.r * 255), Math.round(rgb.g * 255), Math.round(rgb.b * 255)]
}

self.onmessage = async (e: MessageEvent<WorkerMessage>) => {
	const msg = e.data
	const { id, type } = msg

	function sendProgress(progress: number) {
		self.postMessage({ type: 'PROGRESS', id, progress })
	}

	try {
		switch (type) {
			case 'CACHE_AUDIO': {
				const { key, data } = msg
				sendProgress(0)
				const root = await getOpfsRoot()
				const fileHandle = await root.getFileHandle(key, { create: true })

				// todo: look into why the as any here
				const accessHandle = await (fileHandle as any).createSyncAccessHandle()

				sendProgress(50)
				// Truncate to 0 just in case file existed and was larger
				accessHandle.truncate(0)
				accessHandle.write(data)
				accessHandle.flush()
				accessHandle.close()

				sendProgress(100)
				const response: WorkerResponse = { type: 'CACHE_AUDIO', id, success: true }
				self.postMessage(response)
				break
			}

			case 'GET_AUDIO': {
				const { key } = msg
				sendProgress(0)
				const root = await getOpfsRoot()
				try {
					const fileHandle = await root.getFileHandle(key)
					const file = await fileHandle.getFile()
					sendProgress(20)
					const buffer = await file.arrayBuffer()
					sendProgress(100)

					const response: WorkerResponse = { type: 'GET_AUDIO', id, data: buffer }

					// @ts-expect-error: buffer is an ArrayBuffer, which is a transferable object so its fine :D
					self.postMessage(response, [buffer])
				} catch (err: unknown) {
					if (err instanceof DOMException && err.name === 'NotFoundError') {
						const response: WorkerResponse = { type: 'GET_AUDIO', id, data: null }
						self.postMessage(response)
					} else {
						throw err
					}
				}
				break
			}

			case 'DELETE_AUDIO': {
				const { key } = msg
				sendProgress(0)
				const root = await getOpfsRoot()
				try {
					await root.removeEntry(key)
					const response: WorkerResponse = { type: 'DELETE_AUDIO', id, success: true }
					sendProgress(100)
					self.postMessage(response)
				} catch (err: unknown) {
					if (err instanceof DOMException && err.name === 'NotFoundError') {
						const response: WorkerResponse = { type: 'DELETE_AUDIO', id, success: true }
						sendProgress(100)
						self.postMessage(response)
					} else {
						throw err
					}
				}
				break
			}

			case 'COMPUTE_PEAKS': {
				const {
					audioData,
					duration,
					color = '#ffffff',
					pixelRatio = 1,
					audioPoolWidth,
				} = msg

				const float32Data = new Float32Array(audioData)
				const peakLayers = computeMultiResPeaks(float32Data, audioPoolWidth)
				const waveforms: ImageBitmapLODs = {}
				const resolutions = Object.keys(peakLayers.lods).map(Number)
				let completed = 0
				sendProgress(0)

				const [r, g, b] = hexToRgb(color)

				for (const res of resolutions) {
					const peaks = peakLayers.lods[res]
					if (!peaks) continue
					const width = Math.max(1, peaks.length)
					// Fixed height for now as per previous worker
					const fixedHeight = 128

					const offscreen = new OffscreenCanvas(width, fixedHeight)
					const ctx = offscreen.getContext('2d', { alpha: true })

					if (!ctx) throw new Error('Could not get 2d context')

					const imageData = ctx.createImageData(width, fixedHeight)
					const data = imageData.data
					const midY = fixedHeight / 2

					for (let i = 0; i < width; i++) {
						const val = peaks[i] ?? 0
						const barHeight = Math.max(1, val * fixedHeight)
						const yStart = Math.floor(midY - barHeight / 2)
						const yEnd = Math.floor(midY + barHeight / 2)

						for (let y = yStart; y < yEnd; y++) {
							if (y < 0 || y >= fixedHeight) continue
							const index = (y * width + i) * 4
							data[index] = r
							data[index + 1] = g
							data[index + 2] = b
							data[index + 3] = 255
						}
					}

					ctx.putImageData(imageData, 0, 0)

					const bitmap = offscreen.transferToImageBitmap()
					waveforms[res] = bitmap
					completed++
					sendProgress((completed / resolutions.length) * 100)
				}

				const bitmaps = Object.values(waveforms)
				const response: WorkerResponse = { type: 'COMPUTE_PEAKS', id, waveforms }
				// @ts-expect-error: bitmaps are ImageBitmaps, which are transferable objects so its fine :D
				self.postMessage(response, bitmaps)
				break
			}

			case 'CACHE_BITMAPS': {
				// todo: this serialization is prolly not the best :D
				const { key, data } = msg
				const root = await getOpfsRoot()

				const resolutions = Object.keys(data).map(Number)
				const blobs: { res: number; blob: Blob }[] = []
				let totalSize = 0
				let processed = 0
				sendProgress(0)

				for (const res of resolutions) {
					const bitmap = data[res]
					if (!bitmap) continue
					const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
					const ctx = canvas.getContext('2d')
					if (!ctx) continue
					ctx.drawImage(bitmap, 0, 0)
					const blob = await canvas.convertToBlob({ type: 'image/png' })
					blobs.push({ res, blob })
					totalSize += blob.size
					processed++
					sendProgress((processed / resolutions.length) * 50)
				}

				// foramt: [Count: 4bytes] [Res: 4bytes, Size: 4bytes, ...headers] [Data...]
				const count = blobs.length
				const headerSize = 4 + count * 8 // Count + (Res + Size) per item
				const fileTotalSize = headerSize + totalSize

				const fileBuffer = new Uint8Array(fileTotalSize)
				const view = new DataView(fileBuffer.buffer)

				let offset = 0
				view.setUint32(offset, count, true) // Little endian
				offset += 4

				let dataOffset = headerSize
				for (const item of blobs) {
					view.setUint32(offset, item.res, true)
					offset += 4
					view.setUint32(offset, item.blob.size, true)
					offset += 4
				}

				dataOffset = headerSize
				for (const item of blobs) {
					const buf = await item.blob.arrayBuffer()
					fileBuffer.set(new Uint8Array(buf), dataOffset)
					dataOffset += item.blob.size
				}

				const fileKey = `${key}_bitmaps_v${BITMAP_VERISON}_pack`
				const fileHandle = await root.getFileHandle(fileKey, { create: true })
				const accessHandle = await (fileHandle as any).createSyncAccessHandle()
				accessHandle.truncate(0)
				accessHandle.write(fileBuffer)
				accessHandle.flush()
				accessHandle.close()

				sendProgress(100)

				const response: WorkerResponse = { type: 'CACHE_BITMAPS', id, success: true }
				self.postMessage(response)
				break
			}

			case 'GET_BITMAPS': {
				const { key } = msg
				const root = await getOpfsRoot()
				const waveforms: ImageBitmapLODs = {}
				const transfers: ImageBitmap[] = []
				const fileKey = `${key}_bitmaps_v${BITMAP_VERISON}_pack`
				sendProgress(0)

				try {
					const fileHandle = await root.getFileHandle(fileKey)
					const file = await fileHandle.getFile()
					const buffer = await file.arrayBuffer()
					const view = new DataView(buffer)

					let offset = 0
					const count = view.getUint32(offset, true)
					offset += 4

					const headers: { res: number; size: number }[] = []
					for (let i = 0; i < count; i++) {
						const res = view.getUint32(offset, true)
						offset += 4
						const size = view.getUint32(offset, true)
						offset += 4
						headers.push({ res, size })
					}

					let dataOffset = offset // Should be headerSize
					let processed = 0
					sendProgress(20)

					for (const head of headers) {
						// Slice the buffer for this image
						const imageBuffer = buffer.slice(dataOffset, dataOffset + head.size)
						const blob = new Blob([imageBuffer], { type: 'image/png' })
						const bitmap = await createImageBitmap(blob)
						waveforms[head.res] = bitmap
						transfers.push(bitmap)
						dataOffset += head.size
						processed++
						sendProgress(20 + (processed / headers.length) * 80)
					}

					const response: WorkerResponse = { type: 'GET_BITMAPS', id, data: waveforms }
					;(self as any).postMessage(response, transfers)
				} catch {
					// Fallback/Not found
					const response: WorkerResponse = { type: 'GET_BITMAPS', id, data: null }
					self.postMessage(response)
				}
				break
			}

			case 'DELETE_BITMAPS': {
				const { key } = msg
				sendProgress(0)
				const root = await getOpfsRoot()
				const fileKey = `${key}_bitmaps_v${BITMAP_VERISON}_pack`

				try {
					await root.removeEntry(fileKey)
				} catch (e) {
					// Ignore if not found
				}

				const response: WorkerResponse = { type: 'DELETE_BITMAPS', id, success: true }
				sendProgress(100)
				self.postMessage(response)
				break
			}

			case 'PRUNE_FILES': {
				const { validKeys } = msg
				sendProgress(0)
				const root = await getOpfsRoot()
				const validSet = new Set(validKeys)
				let deletedCount = 0

				const BITMAP_PACK_REGEX = /^(.*)_bitmaps(?:_v(\d+))?_pack$/

				// todo: look into this, but i think its fine :D
				// @ts-expect-error property values does not exist on type FileSystemDirectoryHandle
				for await (const entry of root.values()) {
					if (entry.kind !== 'file') continue

					const name = entry.name
					const match = name.match(BITMAP_PACK_REGEX)

					if (match) {
						const key = match[1]
						const versionStr = match[2]
						const version = versionStr ? parseInt(versionStr, 10) : undefined
						const isCurrentVersion = version === BITMAP_VERISON

						if (!isCurrentVersion) {
							try {
								await root.removeEntry(name)
								deletedCount++
							} catch (e) {
								console.error('Failed to prune old version file:', name, e)
							}
						} else {
							if (!validSet.has(key)) {
								try {
									await root.removeEntry(name)
									deletedCount++
								} catch (e) {
									console.error('Failed to prune orphaned file:', name, e)
								}
							}
						}
					} else {
						if (!validSet.has(name)) {
							try {
								await root.removeEntry(name)
								deletedCount++
							} catch (e) {
								console.error('Failed to prune file:', name, e)
							}
						}
					}
				}

				const response: WorkerResponse = { type: 'PRUNE_FILES', id, deletedCount }
				sendProgress(100)
				self.postMessage(response)
				break
			}

			default:
				throw new Error(`Unknown message type: ${type}`)
		}
	} catch (err) {
		console.error(`[AudioWorker] Error processing ${type}:`, err)
		const response: WorkerResponse = { type: 'ERROR', id, error: String(err) }
		self.postMessage(response)
	}
}

type PeakLODs = {
	[samplesPerPeak: number]: Float32Array
}

type PeakLayers = {
	lods: PeakLODs
}

function computeMultiResPeaks(data: Float32Array, audioPoolWidth: number): PeakLayers {
	const lods: { [res: number]: Float32Array } = {}

	// resolution should satisfy the audio pool width
	// shorter clips should have at least audioPoolWidth peaks
	// samples per peak = total samples / pool width
	const poolRes = Math.floor(data.length / audioPoolWidth)

	// Sort ascending (smallest block size = highest resolution first)
	const resolutionsToGenerate = Array.from(new Set([poolRes, ...SAMPLES_PER_PEAK])).sort(
		(a, b) => a - b,
	)

	// heavy loop over raw only once
	// highest res (smallest block size) as base
	const baseRes = resolutionsToGenerate[0]
	if (!baseRes) throw new Error('No resolutions to generate')

	const basePeaks = generateSingleResPeaks(data, baseRes)

	lods[baseRes] = basePeaks

	// low res layers downsampling
	for (let i = 1; i < resolutionsToGenerate.length; i++) {
		const targetRes = resolutionsToGenerate[i]
		if (!targetRes) continue

		const sourceRes = resolutionsToGenerate[i - 1]
		if (!sourceRes) continue

		const sourcePeaks = lods[sourceRes]
		if (!sourcePeaks) continue

		// ratio = target block size / source block size
		// e.g. target 512 / source 256 = 2 source peaks per 1 target peak
		const ratio = targetRes / sourceRes

		const newLen = Math.floor(sourcePeaks.length / ratio)
		const newPeaks = new Float32Array(newLen)

		for (let j = 0; j < newLen; j++) {
			let max = 0
			// start/end in source array
			const start = Math.floor(j * ratio)
			const end = Math.floor((j + 1) * ratio)

			for (let k = start; k < end; k++) {
				const val = sourcePeaks[k]
				if (val === undefined) continue
				if (val > max) max = val
			}

			newPeaks[j] = max
		}
		lods[targetRes] = newPeaks
	}

	return {
		lods,
	}
}

function generateSingleResPeaks(channelData: Float32Array, samplesPerPeak: number): Float32Array {
	const totalPeaks = Math.ceil(channelData.length / samplesPerPeak)
	const result = new Float32Array(totalPeaks)

	const BASE = 10
	const LOG_BASE = Math.log(BASE)
	const stride = Math.max(1, Math.floor(samplesPerPeak / 10))

	for (let i = 0; i < totalPeaks; i++) {
		const start = i * samplesPerPeak
		const end = start + samplesPerPeak

		const safeEnd = Math.min(end, channelData.length)

		let max = 0
		for (let j = start; j < safeEnd; j += stride) {
			const rawVal = channelData[j]
			if (rawVal === undefined) continue
			const val = Math.abs(rawVal)
			if (val > max) max = val
		}

		result[i] = Math.log(1 + (BASE - 1) * max) / LOG_BASE
	}

	return result
}
