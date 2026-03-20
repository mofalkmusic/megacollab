import { computed, reactive, ref, shallowRef, watch, watchEffect } from 'vue'
import {
	type Client,
	type TrackClient,
	type ClipClient,
	type TimelinePos,
	type User,
} from '~/schema'
import { type DebugEntry } from '@/composables/useDebug'
import {
	useDevicePixelRatio,
	useEventListener,
	useIntervalFn,
	useLocalStorage,
	useWindowFocus,
	watchDebounced,
} from '@vueuse/core'
import type { AudioFile } from '@/types'

export const IN_DEV_MODE = import.meta.env.MODE === 'development'

export const user = ref<User | null>(null)
export const client = ref<Client | null>(null)
export const showAdminPanel = shallowRef(false)

export const clips = reactive<Map<string, ClipClient>>(new Map())
export const selectedClipIds = reactive<Set<string>>(new Set())

/** Has to receive deepcloned clips, in order for new edits not to mess with ones clipboard... */
export const clipboardClips = ref<ClipClient[]>([])

type DragSessionBase = {
	mouse_start_x: number
	source_clip: ClipClient
	// source_track_index: number ??
	// maybe add pointerid?
	initial_states: Array<ClipClient>
}

type ResizeDragSession = DragSessionBase &
	(
		| {
				mode: 'left-resize'
				delta_beats_start: number
				initial_start_beat: number
		  }
		| {
				mode: 'right-resize'
				delta_beats_end: number
				initial_end_beat: number
		  }
	)

type MoveDragSession = DragSessionBase & {
	mode: 'move'
	source_track_el: HTMLElement | null
	source_track: TrackClient

	delta_beats: ClipClient['start_beat']
	delta_tracks: number
}

type GainDragSession = DragSessionBase & {
	mode: 'gain'
	delta_gain: ClipClient['gain']
	initial_gain: ClipClient['gain']
	reset_to_default_gain: boolean
	mouse_start_y: number
}

type FadeDragSession = DragSessionBase & {
	mode: 'fade-in' | 'fade-out'
	delta_fade_sec: number
	initial_fade_sec: number
}

export type DragSession = ResizeDragSession | MoveDragSession | GainDragSession | FadeDragSession

export const dragSessionMulti = ref<DragSession | null>(null)

const windowFocused = useWindowFocus()

watch(windowFocused, (focused) => {
	if (!focused) {
		dragSessionMulti.value = null
	}
})

export const tracks = reactive<Map<string, TrackClient>>(new Map())

export const trackIdsInOrderByIndex = computed((): TrackClient['id'][] => {
	return [...tracks.values()].sort((a, b) => a.order_index - b.order_index).map((v) => v.id)
})

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

export const poolPreviewPlayingAudioId = shallowRef<AudioFile['id'] | null>(null)

export const TOTAL_BEATS = 16 * 32

export const DEFAULT_PX_PER_BEAT = 40 as const
const PX_PER_BEAT_TTL_MS = 1_200_000 as const // 20 minutes

type ZoomState = {
	value: number
	timestamp: number
}

const storedPxPerBeat = useLocalStorage<ZoomState>(
	'megacollab-playlist-zoom-px-per-beat',
	{
		value: DEFAULT_PX_PER_BEAT,
		timestamp: Date.now(),
	},
	{ mergeDefaults: true },
)

if (Date.now() - storedPxPerBeat.value.timestamp > PX_PER_BEAT_TTL_MS) {
	storedPxPerBeat.value = {
		value: DEFAULT_PX_PER_BEAT,
		timestamp: Date.now(),
	}
}

export const pxPerBeat = shallowRef(storedPxPerBeat.value['value'])

watchDebounced(
	pxPerBeat,
	(newValue) => {
		storedPxPerBeat.value = {
			value: newValue,
			timestamp: Date.now(),
		}
	},
	{ debounce: 300 },
)

export const maxPxPerBeat = 120 as const
export const minPxPerBeat = 4 as const
export const pxTrackHeight = 70
export const bpm = 128
export const AUDIO_POOL_WIDTH = 160 as const

export const trackControlsWidth = ref(110)

export const audioFilePoolHeightPx = ref(0)

export const timelineWidth = computed(() => TOTAL_BEATS * pxPerBeat.value)

export const { pixelRatio } = useDevicePixelRatio()

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
