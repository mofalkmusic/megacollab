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

			<input
				type="range"
				:min="minPxPerBeat"
				:max="maxPxPerBeat"
				v-model.number="pxPerBeat"
				style="width: 80px; margin-left: 1rem"
			/>

			<div style="flex-grow: 1"></div>

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

		<div class="timeline-scroll-container" ref="timelineContainer" style="grid-area: timeline">
			<TrackControls />
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
		<div
			class="custom-scrollbar scrollbar-x"
			style="grid-area: scollx"
			ref="customScrollbarX"
			:class="{ 'is-dragging': isScrollbarXPressed }"
		>
			<div
				class="custom-thumb thumb-x"
				ref="thumbX"
				:style="{ width: `${scrollIndicatorX.width}%`, left: `${scrollIndicatorX.left}%` }"
			></div>
		</div>

		<div
			class="custom-scrollbar scrollbar-y"
			style="grid-area: scrolly"
			ref="customScrollbarY"
			:class="{ 'is-dragging': isScrollbarYPressed }"
		>
			<div
				class="custom-thumb thumb-y"
				ref="thumbY"
				:style="{ height: `${scrollIndicatorY.height}%`, top: `${scrollIndicatorY.top}%` }"
			></div>
		</div>

		<div style="grid-area: empty"></div>

		<GlobalLoadingIndicator style="grid-area: globalloader" />

		<AudioFilePool style="grid-area: audiopool" />
	</div>
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
			:audiofile="ghostAudioFile"
			:custom-width-px="160"
			:style="{ width: '100%', height: '100%' }"
		/>
	</div>
</template>

<script setup lang="ts">
import Loading from '@/components/Loading.vue'
import { _socketReady, initializeSocket, socket, socketReadyState } from '@/socket/socket'
import {
	computed,
	nextTick,
	onMounted,
	reactive,
	ref,
	shallowRef,
	useTemplateRef,
	watch,
	watchEffect,
	type CSSProperties,
} from 'vue'
import AudioFilePool from '@/components/AudioFilePool.vue'
import {
	pxPerBeat,
	timelineWidth,
	tracks,
	maxPxPerBeat,
	minPxPerBeat,
	controlKeyPressed,
	zKeyPressed,
	activeUploads,
	bpm,
	selectedClipIds,
} from '@/state'
import TrackInstance from '@/components/tracks/TrackInstance.vue'
import {
	useEventListener,
	useMouseInElement,
	useMousePressed,
	useResizeObserver,
	useScroll,
	onClickOutside,
	whenever,
	useElementSize,
	useIntervalFn,
	useElementBounding,
} from '@vueuse/core'
import {
	currentPlayTimeBeats,
	currentPlayTimeSeconds,
	isPlaying,
	pause,
	play,
	reset,
	toggleLoop,
	isLooping,
} from '@/audioEngine'
import UserCursors from '@/components/UserCursors.vue'
import TimelineHeader from '@/components/TimelineHeader.vue'
import TrackControls from '@/components/tracks/TrackControls.vue'
import { px_to_beats, quantize_beats, sec_to_beats } from '@/utils/mathUtils'
import {
	altKeyPressed,
	audiofiles,
	clips,
	dragFromPoolState,
	pxTrackHeight,
	TOTAL_BEATS,
	user,
} from '@/state'
import type { Clip } from '~/schema'
import ClipInstance from '@/components/ClipInstance.vue'
import AddTrack from '@/components/tracks/AddTrack.vue'
import {
	Play,
	Pause,
	Square,
	User,
	Undo2,
	Radio,
	WifiOff,
	ArrowUpDown,
	Menu,
	Repeat,
} from 'lucide-vue-next'
import { offset, useFloating } from '@floating-ui/vue'
import { useRouter } from 'vue-router'
import UserMenu from '@/components/UserMenu.vue'
import { useToast } from '@/composables/useToast'
import { usePing } from '@/composables/usePing'
import GlobalLoadingIndicator from '@/components/GlobalLoadingIndicator.vue'
import { nanoid } from 'nanoid'
import CustomMenuIcon from '@/components/CustomMenuIcon.vue'
const { addToast } = useToast()
const { averagePing } = usePing()

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
	addToast({
		type: 'notification',
		message: 'not implemented yet :D',
		icon: 'mail',
		priority: 'high',
		title: 'Chat',
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
			addToast({
				type: 'notification',
				message: res.error.message,
				icon: 'warning',
				priority: 'medium',
				title: 'Undo Error',
			})
		}
	} catch (e) {
		addToast({
			type: 'notification',
			message: 'unexpected undo error, please try again.',
			icon: 'warning',
			priority: 'medium',
			title: 'Undo Error',
		})
	}
}

useIntervalFn(() => {
	addToast({
		type: 'notification',
		message: 'this is a test toast',
		icon: 'mail',
		priority: 'high',
		title: 'Test Toast',
	})
}, 2000)

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

useEventListener(
	timelineContainerEl,
	'wheel',
	(e) => {
		if (e.ctrlKey) {
			e.preventDefault()
			const sensitivity = 0.05
			const unclipped = pxPerBeat.value - e.deltaY * sensitivity
			pxPerBeat.value = Math.max(minPxPerBeat, Math.min(maxPxPerBeat, unclipped))
		}
	},
	{
		passive: false,
	},
)

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

	const target = event.target as HTMLElement | null
	if (!target) return

	const trackEl = target.closest('.track') as HTMLElement | null
	if (!trackEl) {
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

	const beat = px_to_beats(xInWrapper)

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
	const hash = `${payload.beat.toFixed(4)}_${payload.trackId}_${payload.trackYOffset.toFixed(4)}`

	if (hash !== lastEmittedPayloadHash.value) {
		socket.emit('emit:updatepos', payload)
		lastEmittedPayloadHash.value = hash
	}
}, 100)

const scrollbarXEl = useTemplateRef('customScrollbarX')
const thumbXEl = useTemplateRef('thumbX')

const {
	elementX: scrollbarMouseX,
	elementY: scrollbarMouseY,
	elementWidth: scrollbarWidth,
} = useMouseInElement(scrollbarXEl)
const { pressed: isScrollbarXPressed } = useMousePressed({ target: scrollbarXEl })

const scrollbarYEl = useTemplateRef('customScrollbarY')
const thumbYEl = useTemplateRef('thumbY')

const { elementY: scrollbarYMouseY, elementHeight: scrollbarHeight } =
	useMouseInElement(scrollbarYEl)
const { pressed: isScrollbarYPressed } = useMousePressed({ target: scrollbarYEl })

// where within the thumb the user clicked (to prevent jumping when dragging existing thumb)
const dragOffsetX = shallowRef(0)
const dragOffsetY = shallowRef(0)

// initial click X
watch(isScrollbarXPressed, (pressed) => {
	if (!pressed || !thumbXEl.value || !scrollbarXEl.value) return

	const thumbRect = thumbXEl.value.getBoundingClientRect()
	const trackRect = scrollbarXEl.value.getBoundingClientRect()
	const thumbWidth = thumbRect.width

	// Calculate where the mouse is relative to the start of the thumb
	// (elementX is relative to track, so we convert thumb left to track-relative)
	const thumbRelativeLeft = thumbRect.left - trackRect.left
	const mouseRelativeTimestamp = scrollbarMouseX.value

	const clickIsInsideThumb =
		mouseRelativeTimestamp >= thumbRelativeLeft &&
		mouseRelativeTimestamp <= thumbRelativeLeft + thumbWidth

	if (clickIsInsideThumb) {
		// Scenario A: Clicked thumb. Keep offset so it doesn't jump.
		dragOffsetX.value = thumbRelativeLeft - mouseRelativeTimestamp
	} else {
		// Scenario B: Clicked track. Jump so center of thumb hits mouse.
		dragOffsetX.value = -(thumbWidth / 2)
		// Force an immediate update so it feels responsive instantly
		updateScrollPosition()
	}
})

// initial click Y
watch(isScrollbarYPressed, (pressed) => {
	if (!pressed || !thumbYEl.value || !scrollbarYEl.value) return

	const thumbRect = thumbYEl.value.getBoundingClientRect()
	const trackRect = scrollbarYEl.value.getBoundingClientRect()
	const thumbHeight = thumbRect.height

	// Calculate where the mouse is relative to the start of the thumb
	const thumbRelativeTop = thumbRect.top - trackRect.top
	const mouseRelativeTimestamp = scrollbarYMouseY.value

	const clickIsInsideThumb =
		mouseRelativeTimestamp >= thumbRelativeTop &&
		mouseRelativeTimestamp <= thumbRelativeTop + thumbHeight

	if (clickIsInsideThumb) {
		// Scenario A: Clicked thumb. Keep offset so it doesn't jump.
		dragOffsetY.value = thumbRelativeTop - mouseRelativeTimestamp
	} else {
		// Scenario B: Clicked track. Jump so center of thumb hits mouse.
		dragOffsetY.value = -(thumbHeight / 2)
		// Force an immediate update so it feels responsive instantly
		updateScrollPosition()
	}
})

useEventListener(scrollbarXEl, 'pointerdown', (event) => {
	if (!(event.target instanceof HTMLElement)) return
	event.target.setPointerCapture(event.pointerId)
})

useEventListener(scrollbarXEl, 'pointerup', (event) => {
	if (!(event.target instanceof HTMLElement)) return
	event.target.releasePointerCapture(event.pointerId)
})

useEventListener(scrollbarYEl, 'pointerdown', (event) => {
	if (!(event.target instanceof HTMLElement)) return
	event.target.setPointerCapture(event.pointerId)
})

useEventListener(scrollbarYEl, 'pointerup', (event) => {
	if (!(event.target instanceof HTMLElement)) return
	event.target.releasePointerCapture(event.pointerId)
})

// 5. Watch for movement while pressed
watchEffect(() => {
	if (isScrollbarXPressed.value || isScrollbarYPressed.value) {
		updateScrollPosition()
	}
})

useEventListener('resize', () => {
	updateScrollPosition()
})

function updateScrollPosition() {
	if (!timelineContainerEl.value) return

	// --- X-AXIS SCROLL LOGIC ---
	if (thumbXEl.value && scrollbarXEl.value && isScrollbarXPressed.value) {
		// (Run this after zoom, because zoom changes the scrollWidth/thumbWidth)
		const thumbWidth = thumbXEl.value.clientWidth
		const trackWidth = scrollbarWidth.value

		// The "playable" area is the track width minus the thumb width
		const scrollableWidth = trackWidth - thumbWidth
		if (scrollableWidth > 0) {
			// Calculate desired left position based on mouse + offset
			const targetLeft = scrollbarMouseX.value + dragOffsetX.value

			// Clamp it within bounds
			const clampedLeft = Math.max(0, Math.min(scrollableWidth, targetLeft))

			// Convert pixel position to scroll percentage/ratio
			const ratio = clampedLeft / scrollableWidth

			// Apply to real scroll container
			timelineContainerEl.value.scrollLeft =
				ratio *
				(timelineContainerEl.value.scrollWidth - timelineContainerEl.value.clientWidth)
		}
	}

	// --- Y-AXIS SCROLL LOGIC ---
	if (thumbYEl.value && scrollbarYEl.value && isScrollbarYPressed.value) {
		const thumbHeight = thumbYEl.value.clientHeight
		const trackHeight = scrollbarHeight.value

		const scrollableHeight = trackHeight - thumbHeight
		if (scrollableHeight > 0) {
			const targetTop = scrollbarYMouseY.value + dragOffsetY.value
			const clampedTop = Math.max(0, Math.min(scrollableHeight, targetTop))
			const ratio = clampedTop / scrollableHeight

			timelineContainerEl.value.scrollTop =
				ratio *
				(timelineContainerEl.value.scrollHeight - timelineContainerEl.value.clientHeight)
		}
	}
}

const scrollIndicatorX = computed(() => {
	if (!timelineContainerEl.value) return { width: 0, left: 0 }

	const scrollW = timelineScrollWidth.value
	const visibleW = timelineClientWidth.value

	if (scrollW <= visibleW || scrollW === 0) return { width: 100, left: 0 }

	const left = (scrollX.value / scrollW) * 100
	const widthPercent = (visibleW / scrollW) * 100
	return { width: widthPercent, left }
})

const scrollIndicatorY = computed(() => {
	if (!timelineContainerEl.value) return { height: 0, top: 0 }

	const scrollH = timelineScrollHeight.value
	const visibleH = timelineClientHeight.value

	if (scrollH <= visibleH || scrollH === 0) return { height: 100, top: 0 }

	const top = (scrollY.value / scrollH) * 100
	const heightPercent = (visibleH / scrollH) * 100
	return { height: heightPercent, top }
})

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

const ghostClip = computed<Clip | null>(() => {
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
			const trackEl = els.find((el) => el.classList.contains('track')) as
				| HTMLElement
				| undefined

			let trackId: string | null = null
			let topPx = 0

			if (trackEl) {
				trackId = trackEl.dataset.trackId ?? null
				const trackRect = trackEl.getBoundingClientRect()
				topPx = trackRect.top - wrapperRect.top
			} else {
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
				const tempClip: Clip = {
					id: tempId,
					track_id: state.track_id,
					audio_file_id: source.audioFileId,
					creator_user_id: user.value.id,
					creator_display_name: user.value.display_name, // added display name
					start_beat: state.start_beat,
					end_beat: state.end_beat,
					offset_seconds: 0,
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
						addToast({
							type: 'notification',
							message: res.error.message,
							icon: 'warning',
							priority: 'high',
							title: 'Failed to create clip',
						})
						console.error('failed to create clip:', res.error)
						clips.delete(tempId)
					}
				} catch (err) {
					addToast({
						type: 'notification',
						message: 'An unexpected error occurred while creating the clip.',
						icon: 'warning',
						priority: 'high',
						title: 'Failed to create clip',
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
	if (!controlKeyPressed.value && (e.target as HTMLElement).closest('.clip')) return

	// Don't interact if clicking on the timeline header (e.g. for loop controls)
	if ((e.target as HTMLElement).closest('.timeline-header-wrap')) return

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

	const newSelectedIds = new Set<string>()

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
			newSelectedIds.add(clip.id)
		}
	}

	// Update state
	selectedClipIds.clear()
	newSelectedIds.forEach((id) => selectedClipIds.add(id))
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

.custom-scrollbar {
	background-color: color-mix(in lch, var(--bg-color), white 5%);
	position: relative;
	cursor: pointer;
	z-index: 15;
	overflow: hidden;
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

.custom-thumb {
	background-color: color-mix(in lch, var(--bg-color), white 20%);
	position: absolute;
	cursor: grab;
}

.thumb-x {
	top: 0;
	height: 100%;
	transition:
		width 50ms linear,
		left 50ms linear;
	will-change: width, left;
}

.thumb-y {
	left: 0;
	width: 100%;
	transition:
		height 50ms linear,
		top 50ms linear;
	will-change: height, top;
}
</style>
