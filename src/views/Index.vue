<template>
	<Loading v-if="socket.readyState.value !== 'READY'" />
	<div v-else class="outmost-container">
		<div class="controls" style="grid-area: controls">
			<button
				@click="togglePlayState"
				class="controls-panel-btn"
				:class="{ playing: isPlaying }"
			>
				<Play v-if="!isPlaying" :size="16" style="color: var(--text-color-primary)" />
				<Pause v-else :size="16" style="color: var(--active-playing-color)" />
			</button>
			<button @click="reset" class="controls-panel-btn" style="border-left: none">
				<Square :size="16" style="color: var(--text-color-primary)" />
			</button>
			<button
				@click="toggleLoop"
				class="controls-panel-btn"
				:class="{ looping: isLooping }"
				style="border-left: none"
			>
				<Repeat
					:size="16"
					:style="{
						color: isLooping
							? 'hsl(var(--active-looping-hue) 100% 50% / 1)'
							: 'var(--text-color-primary)',
					}"
				/>
			</button>

			<p class="small mono controls-panel-wrap">
				{{ minutesNseconds }}<br />
				{{ barNumber }}:{{ beatNumber }}
			</p>

			<p class="small mono controls-panel-wrap">{{ bpm }}<br />BPM</p>

			<p
				class="small mono controls-panel-wrap"
				:style="{ color: socketReadyState !== 'READY' ? 'red' : '' }"
			>
				<Radio
					v-if="socketReadyState === 'READY'"
					:size="14"
					style="margin-right: 0.6rem"
				/>
				<WifiOff v-else :size="14" style="margin-right: 0.6rem" />
				{{ socketReadyState === 'READY' ? 'Connected' : 'Offline' }}
			</p>

			<p class="small mono controls-panel-wrap">
				<ArrowUpDown :size="13" style="margin-right: 0.5rem" />
				{{ averagePing }}ms
			</p>

			<button
				ref="downloadButton"
				@click="handleDownload"
				class="controls-panel-btn"
				style="border-left: none"
				:disabled="isRendering"
			>
				<Download
					:size="16"
					:style="{
						color: isRendering ? 'var(--text-color-dim)' : 'var(--text-color-primary)',
					}"
				/>
			</button>

			<div
				style="
					display: flex;
					align-items: center;
					gap: 0.5rem;
					margin-left: 1rem;
					margin-right: 1rem;
				"
			>
				<ZoomIn :size="16" style="color: var(--text-color-primary)" />
				<input
					type="range"
					:min="minPxPerBeat"
					:max="maxPxPerBeat"
					:value="pxPerBeat"
					@input="handleZoomChange"
					style="width: 80px"
					title="Zoom"
				/>
			</div>

			<div style="flex-grow: 1"></div>

			<div style="display: flex; align-items: center; gap: 0.5rem; margin-right: 1rem">
				<Volume2 :size="16" style="color: var(--text-color-primary)" />
				<input
					type="range"
					min="0"
					max="1.5"
					step="0.01"
					v-model.number="masterGainValue"
					@input="setMasterGain(masterGainValue)"
					style="width: 80px"
					title="Master Volume"
				/>
			</div>

			<button
				ref="userButton"
				class="controls-panel-btn"
				@click="isUserMenuOpen = !isUserMenuOpen"
			>
				<CustomMenuIcon :isMenuOpen="isUserMenuOpen" />
			</button>

			<div v-if="isUserMenuOpen" ref="userMenu" style="z-index: 100" :style="floatingStyles">
				<UserMenu
					@on-updated="update()"
					@on-undo="tryUndo()"
					@on-send-chat="sendChat()"
					@on-toggle-loop="toggleLoop()"
				/>
			</div>
		</div>

		<div class="scrollbar-dud" style="grid-area: scolldud"></div>

		<div
			class="timeline-scroll-container"
			ref="timelineContainer"
			style="grid-area: timeline"
			:class="{ panning: isPanning }"
		>
			<TrackControls :scroll-container="timelineContainerEl" />
			<div
				class="all-tracks-wrapper"
				ref="tracksWrapper"
				:style="{ width: `${timelineWidth}px` }"
			>
				<TimelineHeader />
				<div ref="tracksContainerInner">
					<TrackInstance
						v-for="[id, track] in sortedTracks"
						:key="id"
						:track="track"
						:scroll-x="scrollX"
						:timeline-window-width="timelineContainerClientWidth"
					/>
				</div>

				<ClipInstance
					v-if="ghostClip && ghostAudioFile && ghostDragState.track_id"
					:audiofile="ghostAudioFile"
					:clip="ghostClip"
					:parent-track-el="null"
					:style="{
						position: 'absolute',
						height: `${pxTrackHeight}px`,
						top: `${ghostDragState.topPx}px`,
						zIndex: 10,
						pointerEvents: 'none',
						opacity: 0.7,
					}"
				/>

				<UserCursors />

				<div
					v-if="selectionState.isSelecting"
					class="selection-box"
					:style="selectionBoxStyle"
				></div>
			</div>

			<AddTrack @on-track-added="handleTrackAdded" style="grid-area: addtrack" />
		</div>

		<!-- custom scrollbar -->
		<CustomScrollbar
			class="scrollbar-x"
			style="grid-area: scollx"
			orientation="x"
			:scroll-container="timelineContainerEl"
		/>

		<CustomScrollbar
			class="scrollbar-y"
			style="grid-area: scrolly"
			orientation="y"
			:scroll-container="timelineContainerEl"
		/>

		<div style="grid-area: empty"></div>

		<GlobalLoadingIndicator style="grid-area: globalloader" />

		<div class="bottom-row">
			<AudioFilePool />
			<Console />
		</div>
	</div>
	<AdminUserList v-if="showAdminPanel" @close="showAdminPanel = false" />
	<div
		v-if="dragFromPoolState && !ghostDragState.track_id && ghostAudioFile"
		:style="{
			position: 'fixed',
			zIndex: 100,
			pointerEvents: 'none',
			left: `${ghostDragState.globalX - dragFromPoolState.offsetPx}px`,
			top: `${ghostDragState.globalY - 35}px`, // center vertically approx
			width: '160px',
			height: '7rem',
			opacity: 0.8,
			boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
			borderRadius: '6px',
			overflow: 'hidden',
		}"
	>
		<ClipInstance
			:parent-track-el="null"
			:audiofile="ghostAudioFile"
			:custom-width-px="160"
			:style="{ width: '100%', height: '100%' }"
		/>
	</div>
</template>

<script setup lang="ts">
import Loading from '@/components/Loading.vue'
import Console from '@/components/Console.vue'
import { _socketReady, initializeSocket, socket, socketReadyState } from '@/socket/socket'
import CustomScrollbar from '@/components/CustomScrollbar.vue'
import {
	computed,
	nextTick,
	onMounted,
	reactive,
	ref,
	shallowRef,
	useTemplateRef,
	watch,
	type CSSProperties,
} from 'vue'
import AudioFilePool from '@/components/AudioFilePool.vue'
import {
	pxPerBeat,
	timelineWidth,
	tracks,
	maxPxPerBeat,
	minPxPerBeat,
	activeUploads,
	bpm,
	selectedClipIds,
	showAdminPanel,
} from '@/state'
import { altKeyPressed, controlKeyPressed, zKeyPressed } from '@/utils/globalHotKeys'
import TrackInstance from '@/components/TrackInstance.vue'
import {
	useEventListener,
	useResizeObserver,
	useScroll,
	onClickOutside,
	whenever,
	useElementSize,
	useIntervalFn,
	useElementBounding,
} from '@vueuse/core'
import { audiofiles, clips, dragFromPoolState, pxTrackHeight, TOTAL_BEATS, user } from '@/state'
import {
	currentPlayTimeBeats,
	currentPlayTimeSeconds,
	isPlaying,
	pause,
	play,
	reset,
	toggleLoop,
	isLooping,
	masterGainValue,
	setMasterGain,
} from '@/audioEngine'
import UserCursors from '@/components/UserCursors.vue'
import TimelineHeader from '@/components/TimelineHeader.vue'
import TrackControls from '@/components/TrackControls.vue'
import { px_to_beats, quantize_beats, sec_to_beats } from '@/utils/mathUtils'

import type { ClipClient } from '~/schema'
import ClipInstance from '@/components/ClipInstance.vue'
import AddTrack from '@/components/TrackAddButton.vue'
import {
	Play,
	Pause,
	Square,
	Radio,
	WifiOff,
	ArrowUpDown,
	Menu,
	Repeat,
	Download,
	Volume2,
	ZoomIn,
} from 'lucide-vue-next'
import { offset, useFloating } from '@floating-ui/vue'
import UserMenu from '@/components/UserMenu.vue'
import { usePing } from '@/composables/usePing'
import GlobalLoadingIndicator from '@/components/GlobalLoadingIndicator.vue'
import { nanoid } from 'nanoid'
import CustomMenuIcon from '@/components/CustomMenuIcon.vue'
import { useConsole } from '@/composables/useConsole'
import AdminUserList from '@/components/AdminUserList.vue'
import { renderPlaylistOffline } from '@/utils/offlineRenderer'
import { encodeWav, encodeMp3 } from '@/utils/encoders'
import { useGlobalProgress } from '@/composables/useGlobalProgress'
import { menuShortcutsActive } from '@/composables/useMenuShortcutLock'

const { userLog } = useConsole()

const { averagePing } = usePing()

function handleZoomChange(e: Event) {
	if (!(e.target instanceof HTMLInputElement)) {
		return // todo: maybe log error?
	}

	const target = e.target
	const newPxPerBeat = parseFloat(target.value)

	const container = timelineContainerEl.value
	const wrapper = tracksWrapperEl.value

	if (!container || !wrapper) {
		pxPerBeat.value = newPxPerBeat
		return
	}

	// leaving comments here for future humans / agents to understand reasoning behind not using .getboundingclientrect()

	// The track wrapper starts at some horizontal offset (TrackControls width + paddings).
	// offsetLeft is exactly how far `wrapper` is from the left edge of `container`'s scrollable canvas.
	const wrapperOffsetLeft = wrapper.offsetLeft

	// Screen center X relative to the visible window
	const viewportCenterX = timelineClientWidth.value / 2

	// Position within the entire scrollable container canvas (ignoring what's currently visible)
	const canvasCenterX = container.scrollLeft + viewportCenterX

	// Position strictly within the wrapper (the actual timeline)
	const xInWrapper = canvasCenterX - wrapperOffsetLeft

	const beatAtCenter = px_to_beats(xInWrapper)

	// Update zoom state
	pxPerBeat.value = newPxPerBeat

	// Calculate what the new wrapper offset WILL be after zoom
	const newXInWrapper = beatAtCenter * newPxPerBeat

	// Calculate the new scrollLeft so that `newXInWrapper` lands exactly at `viewportCenterX`
	// newScrollLeft + viewportCenterX = wrapperOffsetLeft + newXInWrapper
	container.scrollLeft = wrapperOffsetLeft + newXInWrapper - viewportCenterX
}

const minutesNseconds = computed(() => {
	const sec = currentPlayTimeSeconds.value

	const minutes = Math.floor(sec / 60)
	const seconds = Math.floor(sec % 60)

	// 2‑digit ms
	const centiseconds = Math.floor((sec % 1) * 100)

	const mm = minutes.toString().padStart(2, '0')
	const ss = seconds.toString().padStart(2, '0')
	const cs = centiseconds.toString().padStart(2, '0')

	return `${mm}:${ss}:${cs}`
})

const barNumber = computed(() => {
	return Math.floor(currentPlayTimeBeats.value / 4) + 1
})

const beatNumber = computed(() => {
	return Math.floor(currentPlayTimeBeats.value % 4) + 1
})

const sortedTracks = computed(() => {
	return [...tracks.entries()].sort((a, b) => a[1].order_index - b[1].order_index)
})

// todo
function sendChat() {
	userLog('USER', 'sent a message', {
		textColor: 'orange',
		isBold: true,
		display_name: user.value?.display_name || 'unknown',
		user_id: user.value?.id || '__self__',
	})
}

whenever(
	() => controlKeyPressed.value && zKeyPressed.value,
	() => tryUndo(),
)

async function tryUndo() {
	try {
		const res = await socket.emitWithAck('get:undo', null)
		if (!res.success) {
			userLog('UNDO', `Error: ${res.error.message}`, { textColor: 'orange' })
		}
	} catch (e) {
		userLog('UNDO', 'Unexpected error, please try again.', { textColor: 'red' })
	}
}

const userButtonEl = useTemplateRef('userButton')
const userMenuEl = useTemplateRef('userMenu')
const isUserMenuOpen = shallowRef(false)

const { floatingStyles, update } = useFloating(userButtonEl, userMenuEl, {
	placement: 'bottom-end',
	middleware: [offset({ alignmentAxis: 20, mainAxis: 10 })],
})

useEventListener(window, 'resize', () => {
	update()
})

onClickOutside(
	userMenuEl,
	() => {
		isUserMenuOpen.value = false
	},
	{ ignore: [userButtonEl] },
)

const downloadButtonEl = useTemplateRef('downloadButton')
const isRendering = shallowRef(false)

async function handleDownload() {
	if (isRendering.value) return
	isRendering.value = true

	const format = user.value?.download_quality || 'mp3'

	const progress = useGlobalProgress({ label: `Rendering ${format.toUpperCase()}...` })

	try {
		progress.update(5)
		const renderedBuffer = await renderPlaylistOffline()
		progress.update(50)

		let blob: Blob
		if (format === 'wav') {
			blob = encodeWav(renderedBuffer, (pct) => progress.update(50 + Math.round(pct * 0.45)))
		} else {
			blob = await encodeMp3(renderedBuffer, (pct) =>
				progress.update(50 + Math.round(pct * 0.45)),
			)
		}

		progress.update(95)

		// Trigger browser download
		const url = URL.createObjectURL(blob)
		const a = document.createElement('a')
		a.href = url
		a.download = `mega_collab_playlist.${format}`
		a.click()
		URL.revokeObjectURL(url)

		progress.done()
		userLog('DOWNLOAD', `${format.toUpperCase()} download complete`, { textColor: 'green' })
	} catch (err) {
		progress.error()
		userLog('DOWNLOAD', `Error: ${err instanceof Error ? err.message : 'Unknown error'}`, {
			textColor: 'red',
		})
	} finally {
		isRendering.value = false
	}
}

/*
 * Globally make it so that buttons are not focusable.
 * Handy for spacebar and such accidentally focusing buttons
 * controlling playback and such. This just simplifies things!
 */
useEventListener(window, 'focusin', (e) => {
	if (!(e.target instanceof HTMLButtonElement)) return
	if (e.target instanceof HTMLElement) e.target.blur()
})

useEventListener('keydown', (event) => {
	const target = event.target

	if (
		target instanceof HTMLElement &&
		(target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
	) {
		return
	}

	if (menuShortcutsActive.value) return

	if (event.code === 'Space') {
		event.preventDefault()
		if (isPlaying.value) pause()
		else play()
	}

	if (event.code === 'KeyL') {
		toggleLoop()
	}
})

function togglePlayState() {
	if (isPlaying.value) pause()
	else play()
}

const timelineContainerEl = useTemplateRef('timelineContainer')

import { useDebug } from '@/composables/useDebug'

useEventListener(
	timelineContainerEl,
	'wheel',
	(e) => {
		if (e.ctrlKey) {
			e.preventDefault()
			const container = timelineContainerEl.value
			const wrapper = tracksWrapperEl.value
			if (!container || !wrapper) return

			// beat under cursor before zoom
			const wrapperRect = wrapper.getBoundingClientRect()
			const xInWrapper = e.clientX - wrapperRect.left
			const beatUnderCursor = px_to_beats(xInWrapper)

			useDebug(() => beatUnderCursor, { label: 'hovered_beat' })

			const sensitivity = 0.05 // todo: should be extracted to be reusable instead of hardcoded
			const unclipped = pxPerBeat.value - e.deltaY * sensitivity
			const newPxPerBeat = Math.max(minPxPerBeat, Math.min(maxPxPerBeat, unclipped))
			pxPerBeat.value = newPxPerBeat

			// comment madness for future editors :D

			// Adjust scroll so the same beat stays under the cursor
			// Calculate new X offset for this beat in the wrapper
			const newXInWrapper = beatUnderCursor * newPxPerBeat

			// To keep the beat under the mouse (`e.clientX`), the wrapper needs to be positioned at:
			const newWrapperLeft = e.clientX - newXInWrapper

			// The difference between where the wrapper SHOULD be and where it IS:
			const deltaWrapperLeft = newWrapperLeft - wrapperRect.left

			// scrollLeft decreases wrapper.left, so we subtract the delta
			container.scrollLeft -= deltaWrapperLeft
		}
	},
	{
		passive: false,
	},
)

const isPanning = shallowRef(false)

useEventListener(timelineContainerEl, 'pointerdown', (e) => {
	if (e.button !== 1) return // wheel-click only

	const container = timelineContainerEl.value
	if (!container) return

	// prevent default browser behavior
	e.preventDefault()

	const startX = e.clientX
	const startY = e.clientY
	const startScrollLeft = container.scrollLeft
	const startScrollTop = container.scrollTop

	if (!(e.target instanceof HTMLElement)) return // better pattern than type assertion

	const target = e.target
	target.setPointerCapture(e.pointerId)
	isPanning.value = true

	const onMove = (moveEvent: PointerEvent) => {
		if (!timelineContainerEl.value) return
		const deltaX = moveEvent.clientX - startX
		const deltaY = moveEvent.clientY - startY

		timelineContainerEl.value.scrollLeft = startScrollLeft - deltaX
		timelineContainerEl.value.scrollTop = startScrollTop - deltaY
	}

	const onUp = (upEvent: PointerEvent) => {
		target.releasePointerCapture(upEvent.pointerId)
		isPanning.value = false
		stopMove()
		stopUp()
	}

	const stopMove = useEventListener(window, 'pointermove', onMove)
	const stopUp = useEventListener(window, 'pointerup', onUp)
})

const { x: scrollX, y: scrollY } = useScroll(timelineContainerEl)
const { width: timelineContainerClientWidth } = useElementSize(timelineContainerEl)

async function handleTrackAdded() {
	await nextTick() // awaiting repaint
	if (!timelineContainerEl.value) return
	scrollY.value = timelineContainerEl.value.scrollHeight
}

const timelineScrollHeight = ref(0)
const timelineClientHeight = ref(0)
const timelineScrollWidth = ref(0)
const timelineClientWidth = ref(0)

function updateDims() {
	const el = timelineContainerEl.value
	if (!el) return

	timelineScrollHeight.value = el.scrollHeight
	timelineClientHeight.value = el.clientHeight
	timelineScrollWidth.value = el.scrollWidth
	timelineClientWidth.value = el.clientWidth
}

const tracksWrapperEl = useTemplateRef('tracksWrapper')
const tracksContainerInnerEl = useTemplateRef('tracksContainerInner')
useResizeObserver(tracksWrapperEl, updateDims)

// Cursor Logic
// todo: should be moved to trackinstance for better performance bc it will allow direct access to .track which here i have to get through the target.closest....
const latestCursorPayload = shallowRef<{
	beat: number
	trackId: string
	trackYOffset: number
} | null>(null)
const lastEmittedPayloadHash = ref('')

function handleCursorMove(event: PointerEvent) {
	if (!tracksWrapperEl.value) return

	const target = event.target
	if (!(target instanceof HTMLElement)) return

	const trackEl = target.closest('[data-track-id]')
	if (!(trackEl instanceof HTMLElement)) {
		latestCursorPayload.value = null
		return
	}

	const trackId = trackEl.dataset.trackId
	if (!trackId) {
		latestCursorPayload.value = null
		return
	}

	const rect = trackEl.getBoundingClientRect()
	const yInTrack = event.clientY - rect.top
	const trackYOffset = Math.max(0, Math.min(1, yInTrack / rect.height))

	// For beat calculation, we need X relative to the wrapper
	const wrapperRect = tracksWrapperEl.value.getBoundingClientRect()
	const xInWrapper = event.clientX - wrapperRect.left

	const beat = Math.max(px_to_beats(xInWrapper), 0.0000001)

	latestCursorPayload.value = { beat, trackId, trackYOffset }
}

function handleCursorLeave() {
	latestCursorPayload.value = null
}

// Register listeners on the wrapper
useEventListener(tracksWrapperEl, 'pointermove', handleCursorMove)
useEventListener(tracksWrapperEl, 'pointerleave', handleCursorLeave)

useIntervalFn(() => {
	if (!latestCursorPayload.value) {
		if (lastEmittedPayloadHash.value !== 'cleared') {
			socket.emit('emit:clearpos', null)
			lastEmittedPayloadHash.value = 'cleared'
		}
		return
	}

	const payload = latestCursorPayload.value
	const hash = `${Math.max(0, payload.beat).toFixed(4)}_${payload.trackId}_${payload.trackYOffset.toFixed(4)}`

	if (hash !== lastEmittedPayloadHash.value) {
		socket.emit('emit:updatepos', payload)
		lastEmittedPayloadHash.value = hash
	}
}, 100)

onMounted(async () => {
	await initializeSocket()
})

// --- DRAG FROM POOL LOGIC ---

const ghostDragState = ref<{
	start_beat: number
	end_beat: number
	track_id: string | null
	topPx: number
	globalX: number
	globalY: number
}>({ start_beat: 0, end_beat: 0, track_id: null, topPx: 0, globalX: 0, globalY: 0 })

const ghostAudioFile = computed(() => {
	if (!dragFromPoolState.value) return null
	return audiofiles.get(dragFromPoolState.value.audioFileId)
})

const ghostClip = computed<ClipClient | null>(() => {
	if (!dragFromPoolState.value || !ghostDragState.value || !ghostAudioFile.value) return null
	return {
		id: 'ghost',
		track_id: ghostDragState.value.track_id ?? 'ghost-track',
		audio_file_id: dragFromPoolState.value.audioFileId,
		creator_user_id: 'me',
		creator_display_name: user.value?.display_name ?? 'Me', // added display name
		start_beat: ghostDragState.value.start_beat,
		end_beat: ghostDragState.value.end_beat,
		offset_seconds: 0,
		fade_in_sec: 0,
		fade_out_sec: 0,
		gain: 1,
		created_at: new Date().toISOString(),
		// peaks: ghostAudioFile.value.peaks // Clip doesn't have peaks, AudioFile does.
	}
})

watch(
	() => dragFromPoolState.value,
	(dragState) => {
		if (!dragState) {
			// cleanup listeners handled by watch cleanup or implied?
			// watch callback runs on change.
			// If we want to add/remove listeners:
			return
		}

		ghostDragState.value = {
			start_beat: 0,
			end_beat: 0,
			track_id: null,
			topPx: 0,
			globalX: dragState.clientX,
			globalY: dragState.clientY,
		}

		const onMove = (e: PointerEvent) => {
			if (!dragFromPoolState.value) return
			if (!tracksWrapperEl.value) return

			const wrapperRect = tracksWrapperEl.value.getBoundingClientRect()

			// X / Beat Calculation
			const relativeX = e.clientX - wrapperRect.left - dragFromPoolState.value.offsetPx
			const rawStartBeat = px_to_beats(relativeX)

			let startBeat = altKeyPressed.value ? rawStartBeat : quantize_beats(rawStartBeat)

			// Clamp Left
			startBeat = Math.max(0, startBeat)

			// Calculate End Beat
			const file = audiofiles.get(dragFromPoolState.value.audioFileId)
			if (!file) return

			const durationBeats = sec_to_beats(file.duration)
			let endBeat = startBeat + durationBeats

			// Clamp Right (crop)
			endBeat = Math.min(endBeat, TOTAL_BEATS)

			// Y / Track Calculation
			const els = document.elementsFromPoint(e.clientX, e.clientY)
			const trackEl = els.find(
				(el) => el instanceof HTMLElement && 'trackId' in el.dataset,
			) as HTMLElement | undefined

			let trackId: string | null = null
			let topPx = 0

			if (trackEl) {
				trackId = trackEl.dataset.trackId ?? null
				const trackRect = trackEl.getBoundingClientRect()
				topPx = trackRect.top - wrapperRect.top
			} else {
				// todo: this is some hot garbage, gotta look into this...
				// If not over track, maybe we should hide or check y?
				// For now, let's keep previous valid or default?
				// User said "snapping vertically to tracks".
				// If we are outside tracks, we probably shouldn't show valid snap.
				// Let's just track mouseY relative to wrapper if we wanted to show floating ghost.
				// But sticking to track is safer.
				// If no track found, use null.
			}

			ghostDragState.value = {
				start_beat: startBeat,
				end_beat: endBeat,
				track_id: trackId,
				topPx,
				globalX: e.clientX,
				globalY: e.clientY,
			}
		}

		const onUp = async (e: PointerEvent) => {
			stopMove()
			stopUp()

			const state = ghostDragState.value
			const source = dragFromPoolState.value

			dragFromPoolState.value = null // Clear state immediately

			if (state.track_id && source && user.value) {
				// optimistic clip
				const tempId = `__temp__${nanoid()}`
				const tempClip: ClipClient = {
					id: tempId,
					track_id: state.track_id,
					audio_file_id: source.audioFileId,
					creator_user_id: user.value.id,
					creator_display_name: user.value.display_name, // added display name
					start_beat: state.start_beat,
					end_beat: state.end_beat,
					offset_seconds: 0,
					fade_in_sec: 0,
					fade_out_sec: 0,
					gain: 1,
					created_at: new Date().toISOString(),
				}

				clips.set(tempId, tempClip)

				try {
					const uploadPromise = activeUploads.get(source.audioFileId)

					if (uploadPromise) {
						await uploadPromise
					}

					const currentClip = clips.get(tempId)
					if (!currentClip) return // Clip was deleted by user while uploading

					// Commit using the CURRENT position of the optimistic clip
					const res = await socket.emitWithAck('get:clip:create', {
						audio_file_id: source.audioFileId,
						track_id: currentClip.track_id,
						start_beat: currentClip.start_beat,
						end_beat: currentClip.end_beat,
						offset_seconds: currentClip.offset_seconds,
						gain: currentClip.gain,
					})

					if (res.success) {
						const clip = res.data
						clips.delete(tempId) // Remove the temporary optimistic clip
						clips.set(clip.id, clip)
					} else {
						userLog('SYSTEM', `Failed to create clip: ${res.error.message}`, {
							textColor: 'red',
						})
						console.error('failed to create clip:', res.error)
						clips.delete(tempId)
					}
				} catch (err) {
					userLog('SYSTEM', `An unexpected error occurred while creating the clip.`, {
						textColor: 'red',
					})
					console.error(err)
					clips.delete(tempId)
				}
			}
		}

		const stopMove = useEventListener(window, 'pointermove', onMove)
		const stopUp = useEventListener(window, 'pointerup', onUp)
	},
)

// --- SELECTION LOGIC ---

const selectionState = reactive({
	isSelecting: false,
	startX: 0,
	startY: 0,
	currentX: 0,
	currentY: 0,
})

const selectionBoxStyle = computed((): CSSProperties => {
	if (!selectionState.isSelecting) return {}

	const x = Math.min(selectionState.startX, selectionState.currentX)
	const y = Math.min(selectionState.startY, selectionState.currentY)
	const width = Math.abs(selectionState.currentX - selectionState.startX)
	const height = Math.abs(selectionState.currentY - selectionState.startY)

	return {
		left: `${x}px`,
		top: `${y}px`,
		width: `${width}px`,
		height: `${height}px`,
		position: 'absolute',
		backgroundColor: 'hsl(from cyan h s l / 0.1)',
		border: '2px solid cyan',
		borderRadius: '0.5rem',
		pointerEvents: 'none',
		zIndex: 80,
	}
})

useEventListener(tracksWrapperEl, 'pointerdown', (e) => {
	// Don't interact if clicking on a clip or other interactive element, unless selecting
	if (!controlKeyPressed.value && (e.target as HTMLElement).closest('.clip')) return // todo: dont like the class name usage here, use a dataset in le future!! for robustness

	// Don't interact if clicking on the timeline header (e.g. for loop controls)
	if ((e.target as HTMLElement).closest('.timeline-header-wrap')) return // same here todo

	// Clear selection if clicking on empty space without Control key (Left or Right Click)
	if (!controlKeyPressed.value && (e.button === 0 || e.button === 2)) {
		selectedClipIds.clear()
	}

	// Only allow selection if Control is held
	if (!controlKeyPressed.value) return
	// Only allow left click
	if (e.button !== 0) return

	if (!tracksWrapperEl.value) return
	const wrapperRect = tracksWrapperEl.value.getBoundingClientRect() // todo: this should be done by reactive usebounding or so...

	selectionState.isSelecting = true
	// Relative to wrapper
	const relX = e.clientX - wrapperRect.left
	const relY = e.clientY - wrapperRect.top

	if (relY < headerHeightPx.value) return

	// Snap Y to track height
	const startYSnapped =
		Math.floor((relY - headerHeightPx.value) / pxTrackHeight) * pxTrackHeight +
		headerHeightPx.value

	selectionState.startX = relX
	selectionState.startY = startYSnapped
	selectionState.currentX = relX
	selectionState.currentY = startYSnapped + pxTrackHeight

	// Capture cursor
	;(e.target as HTMLElement).setPointerCapture(e.pointerId)

	updateSelection()
})

// Dynamic header height from tracks container position
const { top: tracksContainerTop } = useElementBounding(tracksContainerInnerEl)
const { top: wrapperTop } = useElementBounding(tracksWrapperEl)
const headerHeightPx = computed(() => tracksContainerTop.value - wrapperTop.value)

useEventListener(tracksWrapperEl, 'pointermove', (e) => {
	if (!selectionState.isSelecting) return
	if (!tracksWrapperEl.value) return

	const wrapperRect = tracksWrapperEl.value.getBoundingClientRect()
	const relX = e.clientX - wrapperRect.left
	const relY = e.clientY - wrapperRect.top

	// Update X (free, but clamped to 0, but not 0 -> 1 so that visually it looks nicer)
	selectionState.currentX = Math.max(1, relX)

	// Update Y (snapped)
	// We want the box to expand to cover the track covering the mouse
	const rawTrackIndex = Math.floor((relY - headerHeightPx.value) / pxTrackHeight)
	const maxIndex = Math.max(0, sortedTracks.value.length - 1)
	const currentTrackIndex = Math.max(0, Math.min(rawTrackIndex, maxIndex))
	const startTrackIndex = Math.floor(
		(selectionState.startY - headerHeightPx.value) / pxTrackHeight,
	)

	// Determine directions
	if (currentTrackIndex >= startTrackIndex) {
		// Dragging down
		selectionState.currentY = (currentTrackIndex + 1) * pxTrackHeight + headerHeightPx.value
	} else {
		// Dragging up
		selectionState.currentY = currentTrackIndex * pxTrackHeight + headerHeightPx.value
	}

	updateSelection()
})

function updateSelection() {
	// Finalize selection
	const boxX = Math.min(selectionState.startX, selectionState.currentX)
	const boxY = Math.min(selectionState.startY, selectionState.currentY)
	const boxW = Math.abs(selectionState.currentX - selectionState.startX)
	const boxH = Math.abs(selectionState.currentY - selectionState.startY)
	const boxRect = { left: boxX, right: boxX + boxW, top: boxY, bottom: boxY + boxH }

	// Find intersects
	// We need clip positions in px relative to wrapper
	// We can iterate clips and calculate their rects

	selectedClipIds.clear()

	for (const clip of clips.values()) {
		// Calculate clip rect
		// X = clip.start_beat * pxPerBeat
		// W = (clip.end_beat - clip.start_beat) * pxPerBeat
		// Y = trackIndex * pxTrackHeight ... wait, we need track index from ID

		const track = tracks.get(clip.track_id)
		if (!track) continue

		// We need the visual order index for Y calculation if tracks are reorderable?
		// Existing code: sortedTracks sorts by order_index.
		// TrackInstance renders in sortedTracks order.
		// So Y = sortedIndex * pxTrackHeight.

		// Let's find index in sortedTracks
		const sorted = [...tracks.entries()].sort((a, b) => a[1].order_index - b[1].order_index)
		const trackIndex = sorted.findIndex(([id]) => id === clip.track_id)

		if (trackIndex === -1) continue

		const clipX = clip.start_beat * pxPerBeat.value
		const clipW = (clip.end_beat - clip.start_beat) * pxPerBeat.value
		const clipY = headerHeightPx.value + trackIndex * pxTrackHeight
		const clipH = pxTrackHeight

		const clipRect = { left: clipX, right: clipX + clipW, top: clipY, bottom: clipY + clipH }

		// Check intersection
		const intersects =
			boxRect.left < clipRect.right &&
			boxRect.right > clipRect.left &&
			boxRect.top < clipRect.bottom &&
			boxRect.bottom > clipRect.top

		if (intersects) {
			selectedClipIds.add(clip.id)
		}
	}
}

useEventListener(tracksWrapperEl, 'pointerup', (e) => {
	if (!selectionState.isSelecting) return

	selectionState.isSelecting = false
	;(e.target as HTMLElement).releasePointerCapture(e.pointerId)
})

// Cancel on blur
useEventListener(window, 'blur', () => {
	if (selectionState.isSelecting) {
		selectionState.isSelecting = false
		// Optionally clear partial selection or just cancel
	}
})
</script>

<style scoped>
.controls {
	display: flex;
	padding: 0;
	border-bottom: 1px solid var(--border-primary);
}

.controls-panel-wrap {
	display: inline-flex;
	padding: 0 1.6rem;
	align-items: center;
	align-content: center;
	line-height: 1.06em;
	border-right: 1px solid var(--border-primary);
}

.open-user-menu-btn {
	border-radius: 50%;
	aspect-ratio: 1/1;
	padding: 0;
}

.timeline-scroll-container.panning {
	cursor: grabbing !important;
}

.outmost-container {
	background-color: transparent;
	width: 100%;
	height: 100vh;
	height: 100svh;

	position: relative;
	overflow: hidden;

	display: grid;

	grid-template-rows: auto auto auto auto 1fr auto auto;
	grid-template-columns: minmax(0, 1fr) auto;

	grid-template-areas: 'controls controls' 'scollx scolldud' 'timeline scrolly' 'addtrack scrolly' 'empty scrolly' 'globalloader scrolly' 'audiopool audiopool';
}

.test-btn {
	padding: 6px 12px;
	background: white;
	color: #333;
	border-radius: 4px;
	border: 1px solid #ccc;
	cursor: pointer;
	font-size: 11px;
	min-width: 140px;
	text-align: right;
	box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.test-btn:hover {
	background: #f0f0f0;
}

.timeline-scroll-container {
	overflow-y: scroll;
	overflow-x: scroll;
	width: 100%;
	height: 100%;

	/* Hide scrollbar for all browsers */
	scrollbar-width: none;
	/* Firefox */
	-ms-overflow-style: none;

	display: grid;
	grid-template-columns: auto 1fr;
	grid-template-rows: 1fr auto;

	grid-template-areas: '. .' 'addtrack addtrack';
}

.timeline-scroll-container::-webkit-scrollbar {
	display: none;
	/* Chrome, Safari, Opera */
}

.all-tracks-wrapper {
	position: relative;
	display: grid;
}

.scrollbar-dud {
	height: 100%;
	width: 100%;
	background-color: color-mix(in lch, var(--bg-color), white 5%);
	box-shadow: inset 1px -1px 0px 0px var(--border-primary);
}

.scrollbar-x {
	height: 1.5rem;
	width: 100%;
	border-bottom: 1px solid var(--border-primary);
}

.scrollbar-y {
	height: 100%;
	width: 1.5rem;
}

.bottom-row {
	grid-area: audiopool;
	display: grid;
	grid-template-columns: 1fr auto;
	align-items: stretch;
}

.download-menu {
	display: grid;
	background-color: color-mix(in lch, var(--bg-color), white 10%);
	border-radius: 0.75rem;
	border: 1px solid var(--border-primary);
}

.download-menu-inner {
	display: grid;
	border-radius: inherit;
	padding: 0.5rem;
	box-shadow: 0px 0px 1rem 0rem var(--bg-color);
}

.download-menu-btn {
	background-color: transparent;
	box-shadow: none;
	justify-content: flex-start;
	white-space: nowrap;
	height: unset;
	padding: 0.6rem 1rem;
}

.download-menu-btn:hover {
	background-color: color-mix(in lch, transparent, white 15%);
	box-shadow: none;
}

.download-option-text {
	display: grid;
	gap: 0px;
	text-align: left;
	line-height: 1.1em;
}
</style>
