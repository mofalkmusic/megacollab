import { computed, reactive, ref, shallowRef, watch, watchEffect } from 'vue'
import {
	type Client,
	type ClientTrack,
	type Clip,
	type ServerTrack,
	type TimelinePos,
	type User,
} from '~/schema'
import { type DebugEntry } from '@/composables/useDebug'
import { useDevicePixelRatio, useEventListener, useIntervalFn, useTimeoutFn } from '@vueuse/core'
import type { AudioFile } from '@/types'

// --- Clipboard & Tool types ---

export type ToolMode = 'hand' | 'brush' | 'magic-brush' | 'slice' | 'mute'

export type ClipboardEntry = {
	relStartBeat: number
	relEndBeat: number
	trackOffset: number // index delta from lowest track in selection
	audioFileId: string
	offsetSeconds: number
	gain: number
	muted: boolean
}

export type BrushSourceClip = {
	audioFileId: string
	lengthBeats: number
	offsetSeconds: number
	gain: number
}

export type MultiDragState = {
	startX: number
	startY: number
	deltaBeats: number
	trackDelta: number
	sourceClipId: string
	clipSnapshots: Map<
		string,
		{
			origStartBeat: number
			origEndBeat: number
			origTrackId: string
		}
	>
}

export const user = ref<User | null>(null)
export const client = ref<Client | null>(null)
export const showAdminPanel = shallowRef(false)

export const clips = reactive<Map<string, Clip>>(new Map())
export const selectedClipIds = reactive<Set<Clip['id']>>(new Set())

export const tracks = reactive<Map<string, ClientTrack>>(new Map())

export const audiofiles = reactive<Map<string, AudioFile>>(new Map())
export const audioBuffers = reactive(new Map<string, AudioBuffer>())

export const debugEntries = ref<Map<string, DebugEntry>>(new Map())

export const globalProgresses = reactive(
	new Map<string, { progress: number; expiresAt: number; label?: string }>(),
)

export const otherUserPositions = reactive<
	Map<string, { pos: TimelinePos; display_name: string; lastUpdated: number }>
>(new Map())

export const activeUploads = new Map<string, Promise<void>>()

export const dragFromPoolState = shallowRef<{
	audioFileId: string
	offsetPx: number
	clientX: number
	clientY: number
} | null>(null)

// --- Tool & Clipboard state ---
export const activeTool = shallowRef<ToolMode>('hand')
export const brushAudioFileId = shallowRef<string | null>(null)
export const brushSourceClip = shallowRef<BrushSourceClip | null>(null)
export const audioPoolPreviewOnClick = shallowRef(false)
export const cloneDragPreview = reactive<{
	visible: boolean
	trackId: string | null
	audioFileId: string | null
	startBeat: number
	endBeat: number
	offsetSeconds: number
	gain: number
	muted: boolean
	topPx: number
}>({
	visible: false,
	trackId: null,
	audioFileId: null,
	startBeat: 0,
	endBeat: 0,
	offsetSeconds: 0,
	gain: 1,
	muted: false,
	topPx: 0,
})
export const clipboardClips = shallowRef<ClipboardEntry[] | null>(null)
export const multiDragState = shallowRef<MultiDragState | null>(null)

export const TOTAL_BEATS = 16 * 16
export const pxPerBeat = shallowRef(40)
export const maxPxPerBeat = 120 as const
export const minPxPerBeat = 12 as const
export const pxTrackHeight = 70
export const bpm = 128
export const AUDIO_POOL_WIDTH = 160 as const

export const audioFilePoolHeightPx = ref(0)

export const timelineWidth = computed(() => TOTAL_BEATS * pxPerBeat.value)

export const { pixelRatio } = useDevicePixelRatio()

export const altKeyPressed = shallowRef(false)
export const controlKeyPressed = shallowRef(false)
export const shiftKeyPressed = shallowRef(false)
export const zKeyPressed = shallowRef(false)
export const tKeyPressed = shallowRef(false)
export const lKeyPressed = shallowRef(false)
export const rightMouseButtonPressedOnTimeline = shallowRef(false)

useEventListener(window, 'pointerdown', (event) => {
	if (event.button === 2) {
		rightMouseButtonPressedOnTimeline.value = true
	}
})

useEventListener(window, 'pointerup', (event) => {
	if (event.button === 2) {
		rightMouseButtonPressedOnTimeline.value = false
	}
})

useEventListener(window, 'blur', () => {
	rightMouseButtonPressedOnTimeline.value = false
})

watchEffect(() => {
	if (rightMouseButtonPressedOnTimeline.value) {
		document.body.classList.add('right-mouse-down')
	} else {
		document.body.classList.remove('right-mouse-down')
	}
})

useIntervalFn(
	() => {
		const now = Date.now()
		for (const [id, data] of globalProgresses) {
			if (now > data.expiresAt) {
				globalProgresses.delete(id)
			}
		}
	},
	1000,
	{ immediate: true },
)

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

	if (event.key === 'Shift') {
		shiftKeyPressed.value = true
		return
	}

	if (event.key === 'z') {
		zKeyPressed.value = true
		return
	}

	if (event.key === 't') {
		tKeyPressed.value = true
		return
	}

	if (event.key === 'l') {
		lKeyPressed.value = true
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

	if (event.key === 'Shift') {
		shiftKeyPressed.value = false
		return
	}

	if (event.key === 'z') {
		zKeyPressed.value = false
		return
	}

	if (event.key === 't') {
		tKeyPressed.value = false
		return
	}

	if (event.key === 'l') {
		lKeyPressed.value = false
		return
	}
})
