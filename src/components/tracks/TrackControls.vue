<template>
	<div class="track-controls-wrapper no-select" :style="wrapperStyles" ref="wrapperRef">
		<div
			v-for="([id, track], index) in sortedTracks"
			:key="id"
			class="track-controls"
			@contextmenu.prevent="openContextMenu($event, id)"
			:class="{
				active: contextMenuTrackId === id,
				'is-muted': mutedTrackIds.has(id),
				'is-dragging-track': reorderState?.draggedId === id,
			}"
			:style="trackControlStyle(id, track)"
			@pointerdown="startReorder($event, id, index)"
			@pointerenter="hoveredTrackId = id"
			@pointerleave="hoveredTrackId === id && (hoveredTrackId = null)"
		>
			<!-- drop indicator -->
			<div
				v-if="
					reorderState &&
					reorderState.insertAtIndex === index &&
					reorderState.draggedId !== id
				"
				class="reorder-indicator top"
			></div>

			<div
				class="track-title-row"
				@dblclick.stop="startRename(id, track.title || `Track ${index + 1}`)"
				@auxclick.stop="onMiddleClick($event, id)"
			>
				<template v-if="renamingTrackId === id">
					<input
						ref="renameInput"
						class="rename-input small"
						v-model="renameValue"
						@blur="commitRename(id)"
						@keydown.enter="($event.target as HTMLInputElement)?.blur()"
						@keydown.escape="cancelRename"
						@click.stop
						@pointerdown.stop
					/>
				</template>
				<template v-else>
					<p v-if="track.title" class="small no-select track-title">{{ track.title }}</p>
					<p v-else class="small dim track-title no-select">Track {{ index + 1 }}</p>
				</template>
			</div>

			<!-- Hidden color input -->
			<input
				v-if="colorPickTrackId === id"
				type="color"
				class="hidden-color-input"
				:value="track.color || '#444444'"
				@input="onColorChange($event, id)"
				@change="colorPickTrackId = null"
				ref="colorInput"
			/>

			<div class="track-actions-row" style="grid-area: actions" @pointerdown.stop>
				<button
					class="menu-trigger-btn"
					@click.stop="toggleContextMenu(id)"
					:class="{ active: contextMenuTrackId === id }"
				>
					<Ellipsis :size="16" />
				</button>
				<div class="sm-buttons">
					<button
						class="sm-btn"
						:class="{ active: soloTrackIds.has(id) }"
						@click.stop="toggleSolo(id)"
						title="Solo"
					>
						S
					</button>
					<button
						class="sm-btn mute"
						:class="{ active: mutedTrackIds.has(id) }"
						@click.stop="toggleMute(id)"
						title="Mute"
					>
						M
					</button>
				</div>
			</div>

			<UseElementBounding v-slot="{ top, height }" style="grid-area: vol">
				<div
					class="volumeSlider"
					@pointerdown.stop="startVolumeDrag($event, id, top, height)"
					@click.stop
					@contextmenu.prevent.stop="resetVolume(id)"
				>
					<div
						class="volume-meter-fill"
						:style="{
							height: `${(trackVolumes.get(id) ?? 0) * 100}%`,
						}"
					></div>
					<div
						class="volume-thumb"
						:style="{
							bottom: `${track.gain * 50}%`,
						}"
					></div>
					<div class="volume-zero-marker"></div>
				</div>
			</UseElementBounding>

			<!-- context menu -->
			<div
				v-if="contextMenuTrackId === id"
				v-on-click-outside="() => (contextMenuTrackId = null)"
				class="context-menu"
				@contextmenu.stop.prevent
				@click.stop
			>
				<div class="inner-menu-wrap">
					<div class="menu-header">
						<p
							class="small bold"
							style="
								color: var(--text-color-primary);
								overflow: hidden;
								text-overflow: ellipsis;
								white-space: nowrap;
							"
						>
							{{ track.title || `Track ${index + 1}` }}
						</p>
						<p
							class="small dim mono"
							style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap"
						>
							@{{ track.belongs_to_display_name }}
						</p>
					</div>
					<div
						style="
							border-top: 1px solid var(--border-primary);
							margin-top: 0.5rem;
							padding-bottom: 0.5rem;
						"
					></div>
					<button
						class="default-button menu-btn"
						@mousedown="startRenameFromMenu(id, track.title || `Track ${index + 1}`)"
					>
						<Pencil :size="13" style="color: var(--text-color-secondary)" />
						<p class="small">Rename</p>
					</button>
					<button class="default-button menu-btn" @mousedown="openColorPicker(id)">
						<Palette :size="13" style="color: var(--text-color-secondary)" />
						<p class="small">Color</p>
					</button>
					<div
						style="
							border-top: 1px solid var(--border-primary);
							margin-top: 0.3rem;
							padding-bottom: 0.3rem;
						"
					></div>
					<button
						class="default-button menu-btn"
						@mousedown="insertTrack(index, 'above')"
					>
						<Plus :size="13" style="color: var(--text-color-secondary)" />
						<p class="small">Insert Above</p>
					</button>
					<button
						class="default-button menu-btn"
						@mousedown="insertTrack(index, 'below')"
					>
						<Plus :size="13" style="color: var(--text-color-secondary)" />
						<p class="small">Insert Below</p>
					</button>
					<div
						style="
							border-top: 1px solid var(--border-primary);
							margin-top: 0.3rem;
							padding-bottom: 0.3rem;
						"
					></div>
					<button class="default-button menu-btn delete" @mousedown="deleteTrack(id)">
						<Trash2 :size="13" style="color: var(--text-color-secondary)" />
						<p class="small">Delete Track</p>
					</button>
				</div>
			</div>

			<!-- bottom drop indicator -->
			<div
				v-if="
					reorderState &&
					reorderState.insertAtIndex === index + 1 &&
					index === sortedTracks.length - 1
				"
				class="reorder-indicator bottom"
			></div>
		</div>
	</div>
</template>

<script setup lang="ts">
import {
	tracks,
	pxTrackHeight,
	altKeyPressed,
	controlKeyPressed,
	clips,
	user,
	mutedTrackIds,
	soloTrackIds,
	hoveredTrackId,
} from '@/state'
import {
	computed,
	reactive,
	nextTick,
	useTemplateRef,
	watch,
	type CSSProperties,
	shallowRef,
} from 'vue'
import { getTrackVolume, isPlaying, setTrackGain, unregisterTrack } from '@/audioEngine'
import { useRafFn, useEventListener } from '@vueuse/core'
import { UseElementBounding, vOnClickOutside } from '@vueuse/components'
import { socket } from '@/socket/socket'
import { useConsole } from '@/composables/useConsole'
import { Trash2, Ellipsis, Pencil, Palette, Plus } from 'lucide-vue-next'
import { DEFAULT_GAIN } from '~/constants'
import type { Clip, ClientTrack } from '~/schema'

const wrapperStyles = computed((): CSSProperties => {
	return {
		gridAutoRows: `${pxTrackHeight}px`,
	}
})

const sortedTracks = computed(() => {
	return [...tracks.entries()].sort((a, b) => a[1].order_index - b[1].order_index)
})

function toggleSolo(trackId: string) {
	if (soloTrackIds.has(trackId)) soloTrackIds.delete(trackId)
	else soloTrackIds.add(trackId)
}

function toggleMute(trackId: string) {
	if (mutedTrackIds.has(trackId)) mutedTrackIds.delete(trackId)
	else mutedTrackIds.add(trackId)
}

// --- Keyboard Shortcuts ---
useEventListener(window, 'keydown', (e: KeyboardEvent) => {
	if (!hoveredTrackId.value) return
	if ((e.target as HTMLElement)?.tagName === 'INPUT') return

	if (e.key === 's' || e.key === 'S') {
		toggleSolo(hoveredTrackId.value)
		e.preventDefault()
	} else if (e.key === 'm' || e.key === 'M') {
		toggleMute(hoveredTrackId.value)
		e.preventDefault()
	}
})

// --- Track Control Style ---
function trackControlStyle(id: string, track: ClientTrack): CSSProperties {
	const style: CSSProperties = {}
	if (track.color) {
		style.backgroundColor = `color-mix(in lch, ${track.color}, var(--bg-color) 70%)`
	}
	return style
}

// --- Rename Logic ---
const renamingTrackId = shallowRef<string | null>(null)
const renameValue = shallowRef('')

function startRename(trackId: string, currentTitle: string) {
	renamingTrackId.value = trackId
	renameValue.value = currentTitle
	nextTick(() => {
		const inputs = document.querySelectorAll<HTMLInputElement>('.rename-input')
		if (inputs.length) inputs[inputs.length - 1]!.select()
	})
}

function startRenameFromMenu(trackId: string, currentTitle: string) {
	contextMenuTrackId.value = null
	startRename(trackId, currentTitle)
}

function cancelRename() {
	renamingTrackId.value = null
	renameValue.value = ''
}

async function commitRename(trackId: string) {
	const newTitle = renameValue.value.trim() || null
	renamingTrackId.value = null

	const track = tracks.get(trackId)
	if (!track) return

	const oldTitle = track.title
	track.title = newTitle

	const res = await socket.emitWithAck('get:track:update', {
		id: trackId,
		changes: { title: newTitle },
	})

	if (!res.success) {
		track.title = oldTitle
		userLog('SYSTEM', `Failed to rename track: ${res.error.message}`, { textColor: 'red' })
	}
}

// --- Color Logic ---
const colorPickTrackId = shallowRef<string | null>(null)

function onMiddleClick(e: MouseEvent, trackId: string) {
	if (e.button !== 1) return
	e.preventDefault()
	openColorPicker(trackId)
}

function openColorPicker(trackId: string) {
	contextMenuTrackId.value = null
	colorPickTrackId.value = trackId
	nextTick(() => {
		const input = document.querySelector<HTMLInputElement>('.hidden-color-input')
		if (input) input.click()
	})
}

async function onColorChange(e: Event, trackId: string) {
	const color = (e.target as HTMLInputElement).value
	const track = tracks.get(trackId)
	if (!track) return

	const oldColor = track.color
	track.color = color

	const res = await socket.emitWithAck('get:track:update', {
		id: trackId,
		changes: { color },
	})

	if (!res.success) {
		track.color = oldColor
		userLog('SYSTEM', `Failed to change color: ${res.error.message}`, { textColor: 'red' })
	}
}

// --- Insert Track ---
async function insertTrack(currentIndex: number, position: 'above' | 'below') {
	contextMenuTrackId.value = null
	if (user.value?.banned_at) return

	const res = await socket.emitWithAck('get:track:create', null)
	if (!res.success) {
		userLog('SYSTEM', `Failed to create track: ${res.error.message}`, { textColor: 'red' })
		return
	}

	const newTrack = res.data
	tracks.set(newTrack.id, newTrack)

	// Reindex: put the new track at the right position
	const sorted = [...tracks.entries()].sort((a, b) => a[1].order_index - b[1].order_index)
	const insertIdx = position === 'above' ? currentIndex : currentIndex + 1

	// Remove from current pos and insert at new pos
	const idList = sorted.map(([id]) => id).filter((id) => id !== newTrack.id)
	idList.splice(insertIdx, 0, newTrack.id)

	// Assign new order_index values and sync
	for (let i = 0; i < idList.length; i++) {
		const tid = idList[i]!
		const track = tracks.get(tid)
		if (!track || track.order_index === i + 1) continue
		track.order_index = i + 1
		socket.emitWithAck('get:track:update', { id: tid, changes: { order_index: i + 1 } })
	}
}

// --- Drag-to-Reorder ---
const reorderState = shallowRef<{
	draggedId: string
	startY: number
	insertAtIndex: number
} | null>(null)

function startReorder(e: PointerEvent, trackId: string, index: number) {
	if (e.button !== 0) return
	if (renamingTrackId.value) return

	const startY = e.clientY
	let moved = false

	const onMove = (ev: PointerEvent) => {
		if (!moved && Math.abs(ev.clientY - startY) < 5) return
		moved = true

		if (!reorderState.value) {
			reorderState.value = { draggedId: trackId, startY, insertAtIndex: index }
		}

		// Determine where to insert
		const wrapperEl = document.querySelector('.track-controls-wrapper')
		if (!wrapperEl) return

		const trackEls = wrapperEl.querySelectorAll('.track-controls')
		let insertAt = sortedTracks.value.length

		for (let i = 0; i < trackEls.length; i++) {
			const rect = trackEls[i]!.getBoundingClientRect()
			const midY = rect.top + rect.height / 2
			if (ev.clientY < midY) {
				insertAt = i
				break
			}
		}

		reorderState.value = { ...reorderState.value!, insertAtIndex: insertAt }
	}

	const onUp = async () => {
		stopMove()
		stopUp()

		if (!moved || !reorderState.value) {
			reorderState.value = null
			return
		}

		const { draggedId, insertAtIndex } = reorderState.value
		reorderState.value = null

		// Recompute order
		const sorted = sortedTracks.value.map(([id]) => id)
		const fromIdx = sorted.indexOf(draggedId)
		if (fromIdx === -1) return

		sorted.splice(fromIdx, 1)
		const targetIdx = insertAtIndex > fromIdx ? insertAtIndex - 1 : insertAtIndex
		sorted.splice(targetIdx, 0, draggedId)

		for (let i = 0; i < sorted.length; i++) {
			const tid = sorted[i]!
			const track = tracks.get(tid)
			if (!track || track.order_index === i + 1) continue
			track.order_index = i + 1
			socket.emitWithAck('get:track:update', { id: tid, changes: { order_index: i + 1 } })
		}
	}

	const stopMove = useEventListener(window, 'pointermove', onMove)
	const stopUp = useEventListener(window, 'pointerup', onUp)
}

const trackVolumes = reactive(new Map<string, number>())
const { userLog } = useConsole()

const DECAY_RATE = 0.15 as const // Lower = slower decay, higher = faster decay (0-1)

const { pause, resume } = useRafFn(
	() => {
		for (const id of tracks.keys()) {
			const currentVol = getTrackVolume(id)
			const prevVol = trackVolumes.get(id) ?? 0

			// Instant rise, smooth decay
			const newVol =
				currentVol >= prevVol ? currentVol : prevVol - (prevVol - currentVol) * DECAY_RATE
			trackVolumes.set(id, Math.max(0, newVol))
		}
	},
	{ fpsLimit: 30, immediate: isPlaying.value },
)

watch(isPlaying, (playing) => {
	if (playing) {
		resume()
	} else {
		pause()
		for (const id of tracks.keys()) {
			trackVolumes.set(id, 0)
		}
	}
})

// --- Context Menu Logic ---
const contextMenuTrackId = shallowRef<string | null>(null)

function openContextMenu(e: MouseEvent, trackId: string) {
	contextMenuTrackId.value = trackId
}

function toggleContextMenu(trackId: string) {
	if (contextMenuTrackId.value === trackId) {
		contextMenuTrackId.value = null
	} else {
		contextMenuTrackId.value = trackId
	}
}

async function deleteTrack(trackId: string) {
	if (user.value?.banned_at) return
	contextMenuTrackId.value = null

	const track = tracks.get(trackId)
	if (!track) return

	const clipsToDelete: Clip[] = []

	for (const [_, clip] of clips.entries()) {
		if (clip.track_id === trackId) clipsToDelete.push(clip)
	}

	clipsToDelete.forEach((clip) => clips.delete(clip.id))

	const optimisticTrack = { ...track }

	unregisterTrack(trackId)
	tracks.delete(trackId)

	const res = await socket.emitWithAck('get:track:delete', { id: trackId })

	if (!res.success) {
		tracks.set(trackId, optimisticTrack)

		clipsToDelete.forEach((clip) => clips.set(clip.id, clip))

		userLog('SYSTEM', `Failed to delete track: ${res.error.message}`, {
			textColor: 'red',
			isBold: true,
		})
	}
}

function startVolumeDrag(e: PointerEvent, trackId: string, top: number, height: number) {
	if (user.value?.banned_at) return
	if (e.button !== 0) return

	const target = e.currentTarget as HTMLElement
	target.setPointerCapture(e.pointerId)

	const track = tracks.get(trackId)
	if (!track) {
		userLog('SYSTEM', 'This track has been deleted.', {
			textColor: 'yellow',
		})
		return
	}
	const initialGain = track.gain

	const SENSITIVITY = 0.2

	const range = 2
	const min = 0

	const startY = e.clientY
	let currentClientY = e.clientY
	const startRelativeY = Math.max(0, Math.min(1, 1 - (e.clientY - top) / height))

	function update(clientY: number) {
		const deltaY = startY - clientY
		const relativeDelta = (deltaY / height) * SENSITIVITY
		const relativeY = Math.max(0, Math.min(1, startRelativeY + relativeDelta))

		let gain: number = min + relativeY * range

		if (altKeyPressed.value || controlKeyPressed.value) {
			gain = 1
		}

		// update local state optimistically
		const track = tracks.get(trackId)

		if (track) {
			track.gain = gain
			setTrackGain(trackId, gain)
		}
	}

	// Initial click update
	update(currentClientY)

	function onMove(e: PointerEvent) {
		currentClientY = e.clientY
		update(currentClientY)
	}

	const { stop: stopKeys } = watch([altKeyPressed, controlKeyPressed], () => {
		update(currentClientY)
	})

	async function onEnd() {
		// Cleanup listeners
		stopMove()
		stopUp()
		stopLostCapture()
		stopKeys()

		if (target.hasPointerCapture(e.pointerId)) {
			target.releasePointerCapture(e.pointerId)
		}

		// Final sync
		const track = tracks.get(trackId)
		if (track) {
			const res = await socket.emitWithAck('get:track:update', {
				id: trackId,
				changes: { gain: track.gain },
			})

			if (!res.success) {
				track.gain = initialGain
				setTrackGain(trackId, initialGain)
				userLog('SYSTEM', `Failed to update track gain: ${res.error.message}`, {
					textColor: 'red',
				})
			}
		}
	}

	const stopMove = useEventListener(window, 'pointermove', onMove)
	const stopUp = useEventListener(window, 'pointerup', onEnd)
	const stopLostCapture = useEventListener(target, 'lostpointercapture', onEnd)
}

async function resetVolume(trackId: string) {
	if (user.value?.banned_at) return
	const track = tracks.get(trackId)
	if (!track) return

	const initialGain = track.gain
	const newGain = DEFAULT_GAIN

	track.gain = newGain // todo: this should be done automatically by settrackgain
	setTrackGain(trackId, newGain)

	const res = await socket.emitWithAck('get:track:update', {
		id: trackId,
		changes: { gain: newGain },
	})

	if (!res.success) {
		// Revert
		track.gain = initialGain
		setTrackGain(trackId, initialGain)
		userLog('SYSTEM', `Failed to reset track gain: ${res.error.message}`, {
			textColor: 'yellow',
		})
	}
}
</script>

<style scoped>
.track-controls-wrapper {
	display: grid;
	grid-auto-rows: auto;
	position: sticky;
	left: 0;
	z-index: 100;

	padding-top: 2rem;
}

.track-title {
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.track-controls {
	padding: 0.8rem 1rem;

	color: var(--text-color-primary);

	z-index: 10;

	display: grid;
	grid-template-columns: 1fr auto;
	grid-template-areas: 'title vol' 'actions vol';

	column-gap: 0.2rem;

	width: 11rem;

	border-bottom: 1px solid var(--border-primary);

	box-shadow: 1px 0px 0px 0px var(--border-primary);

	background-color: var(--bg-color);

	position: relative;
}

.track-title-row {
	grid-area: title;
	display: flex;
	align-items: center;
	gap: 0.3rem;
	min-width: 0;
}

.track-title-row .track-title {
	flex: 1;
	min-width: 0;
}

.sm-buttons {
	display: flex;
	gap: 2px;
	flex-shrink: 0;
}

.sm-btn {
	background: transparent;
	border: 1px solid var(--border-primary);
	color: var(--text-color-secondary);
	font-size: 0.8rem;
	font-weight: 700;
	width: 2rem;
	height: 2rem;
	border-radius: 3px;
	cursor: pointer;
	display: flex;
	align-items: center;
	justify-content: center;
	padding: 0;
	line-height: 1;
	transition: all 80ms ease;
}

.track-actions-row {
	display: flex;
	align-items: center;
	gap: 0.3rem;
	margin-top: auto;
}

.hidden-color-input {
	position: absolute;
	opacity: 0;
	width: 0;
	height: 0;
	pointer-events: none;
	top: 50%;
	left: 50%;
}

.sm-btn:hover {
	background-color: color-mix(in lch, var(--bg-color), white 20%);
}

.sm-btn.active {
	background-color: #e8a620;
	color: #000;
	border-color: #e8a620;
}

.sm-btn.mute.active {
	background-color: #d33;
	color: #fff;
	border-color: #d33;
}

.track-controls.active {
	background-color: color-mix(in lch, var(--bg-color), white 5%);
}

.track-controls:first-child {
	box-shadow: 1px -1px 0px 0px var(--border-primary);
}

.track-controls:last-child {
	border-bottom: none;
}

.volumeSlider {
	position: relative;
	height: 100%;
	width: 1.1rem;

	background-color: color-mix(in lab, var(--border-primary), black 65%);
	display: flex;
	flex-direction: column;
	justify-content: flex-end;
	touch-action: none;
	/* prevent scroll while dragging */
	cursor: ns-resize;
}

.volume-meter-fill {
	width: 100%;
	background: linear-gradient(
		to top,
		var(--border-primary) 10px,
		color-mix(in lch, var(--border-primary), white 60%) 69px
	);
	min-height: 0;
	transition: height 0.1s linear;
}

.volume-thumb {
	position: absolute;
	left: 0;
	right: 0;
	height: 1px;
	background-color: white;
	pointer-events: none;
	box-shadow: 0 0 2px black;
}

.volume-zero-marker {
	position: absolute;
	top: 50%;
	left: 0;
	right: 0;
	height: 1px;
	background-color: color-mix(in lch, var(--border-primary), white 20%);
	opacity: 0.5;
	pointer-events: none;
}

/* Context Menu Styles */
.context-menu {
	position: absolute;
	left: calc(100% + 0.5rem);
	top: 0.5rem;
	width: 14rem;
	border-radius: 0.75rem;
	display: grid;
	z-index: 100;
}

.inner-menu-wrap {
	display: grid;
	border-radius: inherit;
	padding: 0.5rem;
	width: 100%;
	box-shadow: 0px 0px 1rem 0rem var(--bg-color);
	background-color: color-mix(in lch, var(--bg-color), white 10%);
	border: 1px solid var(--border-primary);
}

.menu-header {
	padding: 0.3rem 0.5rem;
	display: flex;
	flex-direction: column;
	gap: 0.1rem;
	max-width: 16rem;
}

.menu-btn {
	background-color: transparent;
	box-shadow: none;
	justify-content: flex-start;
	white-space: nowrap;
	gap: 0.6rem;
	padding-left: 0.6rem;
}

.menu-btn:hover {
	background-color: color-mix(in lch, transparent, white 15%);
	box-shadow: none;
}

.menu-btn.delete {
	color: var(--text-color-primary);
}

.menu-btn.delete:hover {
	background-color: color-mix(in lch, #ff4444, black 20%);
	color: white;
}

.menu-trigger-btn {
	background-color: transparent;
	border: none;
	color: var(--text-color-secondary);
	opacity: 1;
	padding: 0;
	border-radius: 0.25rem;
	display: flex;
	align-items: center;
	justify-content: center;
	cursor: pointer;
	height: min-content;
	width: min-content;

	margin-top: auto;
	position: relative;
}

.menu-trigger-btn::after {
	content: '';
	position: absolute;
	top: -2px;
	bottom: -2px;
	left: -5px;
	right: -5px;
	background-color: inherit;
	border-radius: 0.6rem;
	z-index: -1;
}

.menu-trigger-btn:hover,
.menu-trigger-btn.active {
	background-color: color-mix(in lch, var(--bg-color), white 15%);
	color: var(--text-color-primary);
}

.rename-input {
	background: transparent;
	border: none;
	border-bottom: 1px solid var(--text-color-primary);
	color: var(--text-color-primary);
	outline: none;
	width: 100%;
	padding: 0;
	font: inherit;
}

.track-controls.is-muted {
	opacity: 0.45;
}

.track-controls.is-dragging-track {
	opacity: 0.4;
}

.reorder-indicator {
	position: absolute;
	left: 0;
	right: 0;
	height: 2px;
	background-color: #e8a620;
	z-index: 20;
	pointer-events: none;
}

.reorder-indicator.top {
	top: -1px;
}

.reorder-indicator.bottom {
	bottom: -1px;
}
</style>
