<template>
	<Loading v-if="socket.readyState.value !== 'READY'" />
	<div v-else class="outmost-container">
		<div class="controls" style="grid-area: controls">
			<button @click="togglePlayState" class="controls-panel-btn" :class="{ playing: isPlaying }">
				<Play v-if="!isPlaying" :size="16" style="color: var(--text-color-primary)" />
				<Pause v-else :size="16" style="color: var(--active-playing-color)" />
			</button>
			<button @click="reset" class="controls-panel-btn" style="border-left: none">
				<Square :size="16" style="color: var(--text-color-primary)" />
			</button>

			<div style="flex-grow: 1"></div>

			<button ref="userButton" class="controls-panel-btn" @click="isUserMenuOpen = !isUserMenuOpen">
				<User :size="18" />
			</button>

			<div v-if="isUserMenuOpen" ref="userMenu" style="z-index: 100" :style="floatingStyles">
				<UserMenu @on-updated="update()" @on-undo="tryUndo()" @on-send-chat="sendChat()" />
			</div>
		</div>

		<div class="scrollbar-dud" style="grid-area: scolldud"></div>

		<div class="timeline-scroll-container" ref="timelineContainer" style="grid-area: timeline">
			<TrackControls />
			<div class="all-tracks-wrapper" ref="tracksWrapper" :style="{ width: `${timelineWidth}px` }">
				<TimelineHeader />
				<TrackInstance v-for="[id, track] in tracks" :key="id" :track="track" />

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
			top: `${ghostDragState.globalY - 35}px`, // Center vertically approx
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
import { initializeSocket, socket } from '@/socket/socket'
import {
	computed,
	nextTick,
	onMounted,
	ref,
	shallowRef,
	useTemplateRef,
	watch,
	watchEffect,
} from 'vue'
import AudioFilePool from '@/components/AudioFilePool.vue'
import {
	pxPerBeat,
	timelineWidth,
	tracks,
	maxPxPerBeat,
	controlKeyPressed,
	zKeyPressed,
	activeUploads,
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
} from '@vueuse/core'
import { isPlaying, pause, play, reset } from '@/audioEngine'
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
import { Play, Pause, Square, User, Undo2 } from 'lucide-vue-next'
import { offset, useFloating } from '@floating-ui/vue'
import { useRouter } from 'vue-router'
import UserMenu from '@/components/UserMenu.vue'
import { useToast } from '@/composables/useToast'
import GlobalLoadingIndicator from '@/components/GlobalLoadingIndicator.vue'
import { nanoid } from 'nanoid'
const { addToast } = useToast()

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

const router = useRouter()

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
})

function togglePlayState() {
	if (isPlaying.value) pause()
	else play()
}

const timelineContainerEl = useTemplateRef('timelineContainer')
const { x: scrollX, y: scrollY } = useScroll(timelineContainerEl)

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
useResizeObserver(tracksWrapperEl, updateDims)

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
				ratio * (timelineContainerEl.value.scrollWidth - timelineContainerEl.value.clientWidth)
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
				ratio * (timelineContainerEl.value.scrollHeight - timelineContainerEl.value.clientHeight)
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
		start_beat: ghostDragState.value.start_beat,
		end_beat: ghostDragState.value.end_beat,
		offset_seconds: 0,
		gain_db: 0,
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
			const trackEl = els.find((el) => el.classList.contains('track')) as HTMLElement | undefined

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
					start_beat: state.start_beat,
					end_beat: state.end_beat,
					offset_seconds: 0,
					gain_db: 0,
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
						gain_db: currentClip.gain_db,
					})

					if (res.success) {
						const clip = res.data
						clips.delete(tempId) // Remove the temporary optimistic clip
						clips.set(clip.id, clip)
					} else {
						// todo: add toast
						console.error('failed to create clip:', res.error)
						clips.delete(tempId)
					}
				} catch (err) {
					// todo: add toast
					console.error(err)
					clips.delete(tempId)
				}
			}
		}

		const stopMove = useEventListener(window, 'pointermove', onMove)
		const stopUp = useEventListener(window, 'pointerup', onUp)
	},
)
</script>

<style scoped>
.controls {
	display: flex;
	padding: 0;
	border-bottom: 1px solid var(--border-primary);
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
