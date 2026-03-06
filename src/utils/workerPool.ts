import { AUDIO_POOL_WIDTH } from '@/state'
import type { ImageBitmapLODs } from '@/types'
import kleur from 'kleur'

function print(type: 'log' | 'warn' | 'error', ...args: unknown[]) {
	console[type](kleur.yellow('[POOL]'), ...args)
}

type Task = {
	id: string
	message: WorkerMessage
	resolve: (value: WorkerResponse) => void
	reject: (reason?: unknown) => void
	transfer?: Transferable[]
	onProgress: (progress: number) => void
}

export type WorkerPoolOptions = {
	onProgress?: (progress: number) => void
	transfer?: Transferable[]
}

export class AudioWorkerPool {
	private workers: Worker[] = []
	private queue: Task[] = []
	private activeWorkers = new Set<Worker>()
	private taskMap = new Map<Worker, Task>()
	private maxWorkers: number
	private workerFactory: () => Worker

	constructor(workerFactory: () => Worker) {
		this.workerFactory = workerFactory
		const totalCores = Math.min(17, navigator.hardwareConcurrency || 4)
		this.maxWorkers = Math.max(1, totalCores - 1)
		print('log', this.maxWorkers, 'workers')
		this.initWorkers()
	}

	private initWorkers() {
		for (let i = 0; i < this.maxWorkers; i++) {
			this.createWorker()
		}
	}

	private createWorker() {
		const worker = this.workerFactory()
		worker.onmessage = (e: MessageEvent<WorkerResponse>) => this.handleWorkerMessage(worker, e)
		worker.onerror = (e) => this.handleWorkerError(worker, e)
		this.workers.push(worker)
		return worker
	}

	private handleWorkerMessage(worker: Worker, e: MessageEvent<WorkerResponse>) {
		const { id } = e.data
		const task = this.taskMap.get(worker)

		if (task && task.id === id) {
			if (e.data.type === 'PROGRESS') {
				task.onProgress(e.data.progress)
				return
			}

			if (e.data.type === 'ERROR') {
				task.reject(new Error(e.data.error))
			} else {
				task.resolve(e.data)
			}

			this.taskMap.delete(worker)
			this.activeWorkers.delete(worker)
			this.processQueue()
		} else {
			print('warn', 'Task mismatch or not found', id, task?.id)
		}
	}

	private handleWorkerError(worker: Worker, e: ErrorEvent) {
		const task = this.taskMap.get(worker)

		if (task) {
			task.reject(e.error || new Error('Worker error'))
			this.taskMap.delete(worker)
			this.activeWorkers.delete(worker)
		}

		worker.terminate()

		const index = this.workers.indexOf(worker)
		if (index > -1) this.workers.splice(index, 1)

		this.createWorker()
		this.processQueue()
	}

	private processQueue() {
		if (this.queue.length === 0) return

		const availableWorker = this.workers.find((w) => !this.activeWorkers.has(w))
		if (!availableWorker) return

		const task = this.queue.shift()!

		this.activeWorkers.add(availableWorker)
		this.taskMap.set(availableWorker, task)

		availableWorker.postMessage(task.message, task.transfer || [])
	}

	public execute(message: WorkerMessage, options?: WorkerPoolOptions): Promise<WorkerResponse> {
		return new Promise((resolve, reject) => {
			const task: Task = {
				id: message.id,
				message,
				resolve,
				reject,
				transfer: options?.transfer,
				onProgress: options?.onProgress || (() => {}),
			}

			this.queue.push(task)
			this.processQueue()
		})
	}
}

import AudioWorker from './audio.worker.ts?worker'
export const audioPool = new AudioWorkerPool(() => new AudioWorker())

// HELPERS

export async function cacheAudioFile(id: string, key: string, data: ArrayBuffer) {
	await audioPool.execute(
		{
			type: 'CACHE_AUDIO',
			id: `save-audio-${id}-${Date.now()}`,
			key,
			data,
		},
		{ transfer: [data] },
	)
}

export async function getAudioFile(id: string, key: string) {
	const res = await audioPool.execute({
		type: 'GET_AUDIO',
		id: `get-audio-${id}-${Date.now()}`,
		key,
	})
	if (res.type === 'GET_AUDIO') return res.data
	return null
}

export async function deleteAudioFile(id: string, key: string) {
	await audioPool.execute({
		type: 'DELETE_AUDIO',
		id: `del-audio-${id}-${Date.now()}`,
		key,
	})
}

export async function cacheBitmaps(id: string, key: string, data: ImageBitmapLODs) {
	await audioPool.execute({
		type: 'CACHE_BITMAPS',
		id: `save-bmp-${id}-${Date.now()}`,
		key,
		data,
	})
}

export async function getBitmaps(id: string, key: string) {
	const res = await audioPool.execute({
		type: 'GET_BITMAPS',
		id: `get-bmp-${id}-${Date.now()}`,
		key,
	})
	if (res.type === 'GET_BITMAPS') return res.data
	return null
}

export async function deleteBitmaps(id: string, key: string) {
	await audioPool.execute({
		type: 'DELETE_BITMAPS',
		id: `del-bmp-${id}-${Date.now()}`,
		key,
	})
}

export async function computePeaks(
	id: string,
	audioBuffer: AudioBuffer,
	color?: string,
	onProgress?: (progress: number) => void,
): Promise<ImageBitmapLODs> {
	if (typeof SharedArrayBuffer === 'undefined') {
		throw new Error('SharedArrayBuffer is not supported')
	}

	const channelData = audioBuffer.getChannelData(0)
	const sab = new SharedArrayBuffer(channelData.length * 4)
	const sabView = new Float32Array(sab)
	sabView.set(channelData)

	const res = await audioPool.execute(
		{
			type: 'COMPUTE_PEAKS',
			id,
			audioData: sab,
			duration: audioBuffer.duration,
			color,
			audioPoolWidth: AUDIO_POOL_WIDTH,
		},
		{ onProgress },
	)

	if (res.type === 'COMPUTE_PEAKS') return res.waveforms
	throw new Error('Unexpected worker response type: ' + res.type)
}

export async function pruneAudioCache(validKeys: string[]) {
	const res = await audioPool.execute({
		type: 'PRUNE_FILES',
		id: `prune-${Date.now()}`,
		validKeys,
	})
	if (res.type === 'PRUNE_FILES') return res.deletedCount
	return 0
}

export type WorkerMessage =
	| {
			type: 'CACHE_AUDIO'
			id: string
			key: string
			data: ArrayBuffer
	  }
	| {
			type: 'GET_AUDIO'
			id: string
			key: string
	  }
	| {
			type: 'DELETE_AUDIO'
			id: string
			key: string
	  }
	| {
			type: 'CACHE_BITMAPS'
			id: string
			key: string
			data: ImageBitmapLODs
	  }
	| {
			type: 'GET_BITMAPS'
			id: string
			key: string
	  }
	| {
			type: 'DELETE_BITMAPS'
			id: string
			key: string
	  }
	| {
			type: 'COMPUTE_PEAKS'
			id: string
			audioData: SharedArrayBuffer
			duration: number
			color?: string
			pixelRatio?: number
			audioPoolWidth: number
	  }
	| {
			type: 'PRUNE_FILES'
			id: string
			validKeys: string[]
	  }

export type WorkerResponse =
	| {
			type: 'CACHE_AUDIO'
			id: string
			success: boolean
			error?: string
	  }
	| {
			type: 'GET_AUDIO'
			id: string
			data: ArrayBuffer | null
			error?: string
	  }
	| {
			type: 'DELETE_AUDIO'
			id: string
			success: boolean
			error?: string
	  }
	| {
			type: 'CACHE_BITMAPS'
			id: string
			success: boolean
			error?: string
	  }
	| {
			type: 'GET_BITMAPS'
			id: string
			data: ImageBitmapLODs | null
			error?: string
	  }
	| {
			type: 'DELETE_BITMAPS'
			id: string
			success: boolean
			error?: string
	  }
	| {
			type: 'COMPUTE_PEAKS'
			id: string
			waveforms: ImageBitmapLODs
			error?: string
	  }
	| {
			type: 'PRUNE_FILES'
			id: string
			deletedCount: number
			error?: string
	  }
	| {
			type: 'ERROR'
			id: string
			error: string
	  }
	| {
			type: 'PROGRESS'
			id: string
			progress: number // 0 to 100
	  }
