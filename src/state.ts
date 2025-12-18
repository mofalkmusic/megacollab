import { computed, reactive, ref, shallowRef, watch, watchEffect } from 'vue'
import { type Client, type Clip, type ServerTrack, type User } from '~/schema'
import { useDebug, type DebugEntry } from '@/composables/useDebug'
import type { Toast } from '@/composables/useToast'
import { useDevicePixelRatio, useEventListener, useIntervalFn, useTimeoutFn } from '@vueuse/core'
import type { AudioFile } from '@/types'

export const user = ref<User | null>(null)
export const client = ref<Client | null>(null)

export const clips = reactive<Map<string, Clip>>(new Map())

export const tracks = reactive<Map<string, ServerTrack>>(new Map())

export const audiofiles = reactive<Map<string, AudioFile>>(new Map())
export const audioBuffers = reactive(new Map<string, AudioBuffer>())

export const debugEntries = ref<Map<string, DebugEntry>>(new Map())
export const toasts = ref<Toast[]>([])

export const activeUploads = new Set<Promise<any>>()

export const dragFromPoolState = shallowRef<{
	audioFileId: string
	offsetPx: number
	clientX: number
	clientY: number
} | null>(null)

useDebug(() => audiofiles.size, { label: 'audiofiles' })

export const TOTAL_BEATS = 16 * 16
export const pxPerBeat = shallowRef(40)
export const maxPxPerBeat = 120 as const
export const minPxPerBeat = 12 as const
export const pxTrackHeight = 70
export const bpm = 128
export const AUDIO_POOL_WIDTH = 160 as const

export const timelineWidth = computed(() => TOTAL_BEATS * pxPerBeat.value)

export const { pixelRatio } = useDevicePixelRatio()

export const altKeyPressed = shallowRef(false)
export const controlKeyPressed = shallowRef(false)
export const zKeyPressed = shallowRef(false)

useEventListener(window, 'keydown', (event) => {
	if (event.key === 'Alt') {
		altKeyPressed.value = true
		event.preventDefault()
		return
	}

	if (event.key === 'Control') {
		controlKeyPressed.value = true
		return
	}

	if (event.key === 'z') {
		zKeyPressed.value = true
		return
	}
})

useEventListener(window, 'keyup', (event) => {
	if (event.key === 'Alt') {
		altKeyPressed.value = false
		event.preventDefault()
		return
	}

	if (event.key === 'Control') {
		controlKeyPressed.value = false
		return
	}

	if (event.key === 'z') {
		zKeyPressed.value = false
		return
	}
})
