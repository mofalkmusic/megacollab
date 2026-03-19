<template>
	<div class="track-controls-wrapper no-select" :style="wrapperStyles" ref="wrapperRef">
		<div
			v-for="([id, track], index) in sortedTracks"
			:key="id"
			class="track-controls"
			@contextmenu.prevent="openContextMenu(id)"
			:class="{
				active: contextMenuTrackId === id,
				'drop-target-top':
					dragState.dropTargetIndex === index && dragState.dropPosition === 'top',
				'drop-target-bottom':
					dragState.dropTargetIndex === index && dragState.dropPosition === 'bottom',
				'is-dragged': dragState.draggedTrackId === id,
			}"
			:draggable="true"
			@dragstart="onDragStart($event, id, index)"
			@dragover.prevent="onDragOver($event, index)"
			@dragenter.prevent
			@dragleave="onDragLeave($event, index)"
			@drop.prevent="onDrop($event, index)"
			@dragend="onDragEnd"
		>
			<div
				class="title-container"
				@dblclick="startTrackRename(id)"
				:class="{ renaming: renamingTrackId === id }"
			>
				<input
					v-if="renamingTrackId === id"
					v-model="renamingTitle"
					ref="trackTitleInput"
					class="txt small track-title-input no-select"
					@keydown.enter="commitRename"
					@keydown.esc="cancelRename"
					@blur="commitRename"
					maxlength="30"
				/>
				<p v-else-if="track.title" class="small no-select title-p">{{ track.title }}</p>
				<p v-else class="small dim track-title no-select title-p">Track {{ index + 1 }}</p>
			</div>

			<div style="grid-area: vol" class="volumeSlider" @click.stop>
				<div
					class="volume-meter-fill"
					:style="{
						height: `${(trackVolumes.get(id) ?? 0) * 100}%`,
					}"
				></div>
			</div>

			<div
				style="
					grid-area: menu;
					display: flex;
					align-items: center;
					justify-content: flex-start;
					gap: calc(2 * 3px);
				"
			>
				<button
					class="menu-trigger-btn mute"
					@click.stop="toggleMute(id)"
					:class="{ active: mutedTrackIds.has(id) }"
				>
					<p class="small" style="color: inherit">M</p>
				</button>
				<button
					class="menu-trigger-btn solo"
					@click.stop="toggleSolo(id)"
					:class="{ active: soloTrackIds.has(id) }"
				>
					<p class="small" style="color: inherit">S</p>
				</button>
				<button
					class="menu-trigger-btn"
					@click.stop="toggleContextMenu(id)"
					:class="{ active: contextMenuTrackId === id }"
				>
					<Ellipsis :size="16" />
				</button>
			</div>

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
					<MenuDividerLine :distance="0.5" />
					<button class="default-button menu-btn" @click="startTrackRename(id)">
						<Pencil :size="12" style="color: var(--text-color-secondary)" />
						<p class="small"><span class="action-key-underline">R</span>ename</p>
					</button>
					<MenuDividerLine :distance="0.5" />
					<button
						class="default-button menu-btn"
						@mousedown="reorderTrack(id, index, 'up')"
						:disabled="index === 0"
						:style="{ opacity: index === 0 ? 0.5 : 1 }"
					>
						<ArrowUp :size="13" style="color: var(--text-color-secondary)" />
						<p class="small">Move <span class="action-key-underline">U</span>p</p>
					</button>
					<button
						class="default-button menu-btn"
						@mousedown="reorderTrack(id, index, 'down')"
						:disabled="index === sortedTracks.length - 1"
						:style="{ opacity: index === sortedTracks.length - 1 ? 0.5 : 1 }"
					>
						<ArrowDown :size="13" style="color: var(--text-color-secondary)" />
						<p class="small">Move D<span class="action-key-underline">o</span>wn</p>
					</button>
					<MenuDividerLine :distance="0.5" />
					<button class="default-button menu-btn" @mousedown="addTrackAbove(index)">
						<Plus :size="13" style="color: var(--text-color-secondary)" />
						<p class="small"><span class="action-key-underline">A</span>dd Track</p>
					</button>
					<MenuDividerLine :distance="0.5" />
					<button
						class="default-button menu-btn delete"
						@mousedown="deleteTrack(id)"
						:disabled="!(user?.roles.includes('admin') || user?.roles.includes('mod'))"
						:style="{
							opacity: !(user?.roles.includes('admin') || user?.roles.includes('mod'))
								? 0.5
								: 1,
						}"
					>
						<Trash2 :size="13" style="color: var(--text-color-secondary)" />
						<p class="small"><span class="action-key-underline">D</span>elete Track</p>
					</button>
				</div>
			</div>
		</div>
	</div>
</template>

<script setup lang="ts">
import { tracks, pxTrackHeight, clips, user, trackControlsWidth, IN_DEV_MODE } from '@/state'
import {
	computed,
	reactive,
	useTemplateRef,
	watch,
	type CSSProperties,
	shallowRef,
	nextTick,
	onBeforeUnmount,
} from 'vue'
import {
	getTrackVolume,
	isPlaying,
	unregisterTrack,
	mutedTrackIds,
	soloTrackIds,
	toggleMute,
	toggleSolo,
} from '@/audioEngine'
import { useRafFn, useElementSize, useEventListener } from '@vueuse/core'
import { vOnClickOutside } from '@vueuse/components'
import { socket } from '@/socket/socket'
import { useConsole } from '@/composables/useConsole'
import { Trash2, Ellipsis, ArrowUp, ArrowDown, Plus, SquarePen, Pencil } from 'lucide-vue-next'
import type { ClipClient } from '~/schema'
import MenuDividerLine from '@/components/MenuDividerLine.vue'
import { menuShortcutsActive } from '@/composables/useMenuShortcutLock'

const props = defineProps<{
	scrollContainer: HTMLElement | null
}>()

const wrapperStyles = computed((): CSSProperties => {
	return {
		gridAutoRows: `${pxTrackHeight}px`,
	}
})

const wrapperRef = useTemplateRef('wrapperRef')
const { width: wrapperWidth } = useElementSize(wrapperRef)

watch(wrapperWidth, (newWidth) => {
	trackControlsWidth.value = newWidth
})

const sortedTracks = computed(() => {
	return [...tracks.entries()].sort((a, b) => a[1].order_index - b[1].order_index)
})

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

const contextMenuTrackId = shallowRef<string | null>(null)

function openContextMenu(trackId: string) {
	contextMenuTrackId.value = trackId
}

function closeContextMenu() {
	contextMenuTrackId.value = null
}

function toggleContextMenu(trackId: string) {
	if (contextMenuTrackId.value === trackId) {
		closeContextMenu()
	} else {
		openContextMenu(trackId)
	}
}

watch(contextMenuTrackId, (trackId, _, onCleanup) => {
	if (!trackId) return
	// no cleanup needed bc cleanup gets invoked before new value is set

	menuShortcutsActive.value = true

	function handleMenuKeydown(event: KeyboardEvent) {
		const id = contextMenuTrackId.value
		if (!id) return

		const index = sortedTracks.value.findIndex(([tid]) => tid === id)
		if (index === -1) return

		switch (event.key.toLowerCase()) {
			case 'u':
				reorderTrack(id, index, 'up')
				break
			case 'o':
				reorderTrack(id, index, 'down')
				break
			case 'a':
				addTrackAbove(index)
				closeContextMenu()
				break
			case 'd':
				deleteTrack(id)
				break
			case 'r':
				startTrackRename(id)
				closeContextMenu()
				break
			default:
				return // don't prevent default for other keys
		}

		event.preventDefault()
		event.stopPropagation()
	}

	const stopListener = useEventListener(window, 'keydown', handleMenuKeydown)

	onCleanup(() => {
		stopListener()
		menuShortcutsActive.value = false
	})
})

onBeforeUnmount(() => (menuShortcutsActive.value = false))

const renamingTrackId = shallowRef<string | null>(null)
const renamingTitle = shallowRef('')
const trackTitleInput = useTemplateRef<HTMLElement[]>('trackTitleInput')

async function startTrackRename(trackId: string) {
	if (renamingTrackId.value) {
		await commitRename()
	}

	const track = tracks.get(trackId)
	if (!track) return

	renamingTrackId.value = trackId
	renamingTitle.value = track.title ?? ''

	await nextTick()
	const input = trackTitleInput.value?.[0] as HTMLInputElement | undefined
	if (input) {
		input.focus()
		input.select()
	}
}

async function commitRename() {
	const id = renamingTrackId.value
	if (!id) return

	const track = tracks.get(id)
	if (!track) {
		cancelRename()
		return
	}

	const newTitle = renamingTitle.value.trim().slice(0, 30) || null
	const oldTitle = track.title

	if (newTitle === oldTitle) {
		cancelRename()
		return
	}

	// Optimistic update
	track.title = newTitle
	renamingTrackId.value = null

	const res = await socket.emitWithAck('get:track:update', {
		id,
		changes: { title: newTitle },
	})

	if (res.success) return

	// Rollback
	track.title = oldTitle
	userLog('SYSTEM', `Failed to rename track: ${res.error.message}`, {
		textColor: 'red',
	})
}

function cancelRename() {
	renamingTrackId.value = null
	renamingTitle.value = ''
}

// Ensure rename UI closes if track is deleted while editing
watch(tracks, (newTracks) => {
	if (renamingTrackId.value && !newTracks.has(renamingTrackId.value)) {
		cancelRename()
	}
})

const dragState = reactive<{
	draggedTrackId: string | null
	draggedTrackIndex: number | null
	dropTargetIndex: number | null
	dropPosition: 'top' | 'bottom' | null
}>({
	draggedTrackId: null,
	draggedTrackIndex: null,
	dropTargetIndex: null,
	dropPosition: null,
})

function onDragStart(event: DragEvent, id: string, index: number) {
	if (!(event.target instanceof HTMLElement)) return

	if (
		event.target.closest('button') ||
		event.target.closest('.volumeSlider') ||
		event.target.closest('.context-menu')
	) {
		event.preventDefault()
		return
	}

	closeContextMenu()

	dragState.draggedTrackId = id
	dragState.draggedTrackIndex = index

	if (event.dataTransfer) {
		event.dataTransfer.effectAllowed = 'move'
		event.dataTransfer.setData('text/plain', id)

		const img = new Image()
		img.src = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs='
		event.dataTransfer.setDragImage(img, 0, 0)
	}
}

function onDragOver(event: DragEvent, index: number) {
	if (dragState.draggedTrackId === null || dragState.draggedTrackIndex === null) return

	if (event.dataTransfer) {
		event.dataTransfer.dropEffect = 'move'
	}

	const target = event.currentTarget as HTMLElement
	const rect = target.getBoundingClientRect()
	const relY = event.clientY - rect.top
	const isTopHalf = relY < rect.height / 2

	const draggedIdx = dragState.draggedTrackIndex

	const isGapBeforeDragged =
		(index === draggedIdx && isTopHalf) || (index === draggedIdx - 1 && !isTopHalf)
	const isGapAfterDragged =
		(index === draggedIdx && !isTopHalf) || (index === draggedIdx + 1 && isTopHalf)

	if (isGapBeforeDragged || isGapAfterDragged) {
		dragState.dropTargetIndex = null
		dragState.dropPosition = null
		return
	}

	dragState.dropTargetIndex = index
	dragState.dropPosition = isTopHalf ? 'top' : 'bottom'
}

function onDragLeave(event: DragEvent, index: number) {
	if (dragState.draggedTrackId === null) return
	const relatedTarget = event.relatedTarget as Node | null
	const currentTarget = event.currentTarget as Node
	if (relatedTarget && currentTarget.contains(relatedTarget)) {
		return
	}

	if (dragState.dropTargetIndex === index) {
		dragState.dropTargetIndex = null
		dragState.dropPosition = null
	}
}

async function onDrop(event: DragEvent, index: number) {
	const fromId = dragState.draggedTrackId
	const fromIndex = dragState.draggedTrackIndex
	const toIndex = dragState.dropTargetIndex
	const position = dragState.dropPosition

	dragState.draggedTrackId = null
	dragState.draggedTrackIndex = null
	dragState.dropTargetIndex = null
	dragState.dropPosition = null

	if (!fromId || fromIndex === null || toIndex === null || !position) return

	const targetTuple = sortedTracks.value[toIndex]
	if (!targetTuple) return
	if (fromId === targetTuple[0]) return

	const sorted = sortedTracks.value
	if (sorted.length <= 1) return

	const track = tracks.get(fromId)
	if (!track) return

	const sortedWithoutDragged = sorted.filter((t) => t[0] !== fromId)
	const targetId = targetTuple[0]
	const targetIndexInNewArray = sortedWithoutDragged.findIndex((t) => t[0] === targetId)

	if (targetIndexInNewArray === -1) return

	let trackAboveIndex: number
	let trackBelowIndex: number
	let isDroppingAtTop: boolean

	if (position === 'top') {
		trackBelowIndex = targetIndexInNewArray
		trackAboveIndex = targetIndexInNewArray - 1
		isDroppingAtTop = true
	} else {
		trackAboveIndex = targetIndexInNewArray
		trackBelowIndex = targetIndexInNewArray + 1
		isDroppingAtTop = false
	}

	const newOrderIndex = orderIndexBetween(
		sortedWithoutDragged,
		trackAboveIndex,
		trackBelowIndex,
		() => {
			const edgeIdx = isDroppingAtTop ? 0 : sortedWithoutDragged.length - 1
			return sortedWithoutDragged[edgeIdx]![1].order_index + (isDroppingAtTop ? -1 : 1)
		},
	)

	const oldOrderIndex = track.order_index
	track.order_index = newOrderIndex

	const res = await socket.emitWithAck('get:track:update', {
		id: fromId,
		changes: { order_index: newOrderIndex },
	})

	if (res.success) return

	track.order_index = oldOrderIndex

	userLog('SYSTEM', `Failed to reorder track: ${res.error.message}`, {
		textColor: 'red',
	})
}

function onDragEnd() {
	dragState.draggedTrackId = null
	dragState.draggedTrackIndex = null
	dragState.dropTargetIndex = null
	dragState.dropPosition = null
}

async function deleteTrack(trackId: string) {
	const track = tracks.get(trackId)
	if (!track) return

	const hasPrivilege = user.value?.roles.includes('admin') || user.value?.roles.includes('mod')
	const isCreator = track.creator_user_id && track.creator_user_id === user.value?.id

	if (!hasPrivilege && !isCreator) {
		userLog('SYSTEM', 'You do not have permission to delete this track', {
			textColor: 'red',
		})
		return
	}

	contextMenuTrackId.value = null

	const clipsToDelete: ClipClient[] = []

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

function orderIndexBetween(
	sorted: typeof sortedTracks.value,
	trackAboveIndex: number,
	trackBelowIndex: number,
	edgeFallback: () => number,
) {
	// puts track between two neighbors / offset from edge at boundary
	const trackAbove = sorted[trackAboveIndex]?.[1]
	const trackBelow = sorted[trackBelowIndex]?.[1]

	if (trackAbove && trackBelow) {
		return (trackAbove.order_index + trackBelow.order_index) / 2
	}

	return edgeFallback()
}

async function reorderTrack(trackId: string, currentIndex: number, direction: 'up' | 'down') {
	if (user.value?.banned_at) return

	const track = tracks.get(trackId)
	if (!track) return

	const sorted = sortedTracks.value
	if (sorted.length <= 1) return

	const isUp = direction === 'up'

	const atBoundary = isUp ? currentIndex === 0 : currentIndex === sorted.length - 1

	if (atBoundary) return

	const trackAboveIndex = isUp ? currentIndex - 2 : currentIndex + 1
	const trackBelowIndex = isUp ? currentIndex - 1 : currentIndex + 2

	const newOrderIndex = orderIndexBetween(sorted, trackAboveIndex, trackBelowIndex, () => {
		const edgeIdx = isUp ? 0 : sorted.length - 1
		return sorted[edgeIdx]![1].order_index + (isUp ? -1 : 1)
	})

	const oldOrderIndex = track.order_index
	track.order_index = newOrderIndex

	await nextTick()
	await nextTick()

	const container = props.scrollContainer
	if (container) {
		container.scrollTop += isUp ? -pxTrackHeight : pxTrackHeight
	}

	const res = await socket.emitWithAck('get:track:update', {
		id: trackId,
		changes: { order_index: newOrderIndex },
	})

	if (res.success) return // all worked out :)

	track.order_index = oldOrderIndex

	userLog('SYSTEM', `Failed to reorder track: ${res.error.message}`, {
		textColor: 'red',
	})

	if (IN_DEV_MODE) {
		userLog('SYSTEM', `You probably solve this by doing "bun cleanup" bc db migration is messy`)
	}
}

async function addTrackAbove(currentIndex: number) {
	if (user.value?.banned_at) return

	const sorted = sortedTracks.value
	const trackAboveIndex = currentIndex - 1
	const trackBelowIndex = currentIndex

	const newOrderIndex = orderIndexBetween(sorted, trackAboveIndex, trackBelowIndex, () => {
		// edge fallback but idk if this is a good idea. keeping it for now
		// todo: evaluate this
		const firstTrack = sorted[0]
		return firstTrack ? firstTrack[1].order_index / 2 : 0
	})

	const { success, data, error } = await socket.emitWithAck('get:track:create', {
		order_index: newOrderIndex,
	})

	if (!success) {
		userLog('SYSTEM', `Failed to create track: ${error.message}`, {
			textColor: 'red',
		})
		console.error(error)
		return
	}

	tracks.set(data.id, data)

	await nextTick()
	await nextTick() // more ticks more good :D

	const container = props.scrollContainer

	if (container) container.scrollTop += pxTrackHeight
}
</script>

<style scoped>
.track-controls-wrapper {
	display: grid;
	grid-auto-rows: auto;
	position: sticky;
	left: 0;
	z-index: 100;

	margin-top: 2rem;
}

.track-title {
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.title-container {
	grid-area: title;
	display: flex;
	align-items: center;
	min-width: 0;
	height: 1.8rem;
	position: relative;
	cursor: text;
}

.title-p {
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	width: 100%;
}

.track-title-input {
	border: none;
	background-color: rgba(255, 255, 255, 0.08);
	padding: 2px 4px;
	margin-left: -4px; /* offset padding to avoid shifting */
	width: 100%;
	color: inherit;
	font-family: inherit;
	line-height: inherit;
	outline: none;
	border-bottom: 1px solid var(--text-color-secondary);
}

.track-controls {
	padding: 0.8rem 1rem;
	/* background-color: hsl(0, 0%, 9%); */

	color: var(--text-color-primary);

	z-index: 10;

	display: grid;
	grid-template-columns: 1fr auto;
	grid-template-areas: 'title vol' 'menu vol';

	column-gap: 0.2rem;

	width: 11rem;

	border-bottom: 1px solid var(--border-primary);

	box-shadow: 1px 0px 0px 0px var(--border-primary);

	background-color: var(--bg-color);

	position: relative;
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

.menu-header-outer {
	display: grid;
	grid-template-columns: 1fr auto;
	gap: 0.6rem;
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

.menu-btn.delete:not(:disabled):hover {
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

	margin-top: auto;
	position: relative;

	--_size: 1.6rem;
	height: var(--_size);
	width: var(--_size);
}

.menu-trigger-btn::after {
	content: '';
	position: absolute;
	inset: -2px;
	background-color: inherit;
	border-radius: 0.6rem;
	z-index: -1;
}

.menu-trigger-btn:hover,
.menu-trigger-btn.active {
	background-color: color-mix(in lch, var(--bg-color), white 15%);
	color: var(--text-color-primary);
}

.menu-trigger-btn.mute.active {
	--_col: #ff4444;
	color: var(--_col);
	font-weight: bold;
	background-color: color-mix(in lch, var(--_col), var(--bg-color) 80%);
}

.menu-trigger-btn.mute.active::after {
	box-shadow: inset 0px 0px 7px -3px var(--_col);
}

.menu-trigger-btn.solo.active {
	background-color: color-mix(in lch, var(--solo-color), var(--bg-color) 40%);
	color: white;
	font-weight: bold;
}
.menu-trigger-btn.solo.active::after {
	border: 1px solid color-mix(in lch, var(--solo-color), transparent 50%);
	box-shadow: inset 0px 0px 7px -3px var(--solo-color);
}

.track-controls.is-dragged {
	opacity: 0.7;
}

.track-controls.drop-target-top::before {
	content: '';
	position: absolute;
	top: -2px;
	left: 0;
	right: 0;
	height: 2px;
	background-color: var(--text-color-primary);
	z-index: 20;
}

.track-controls.drop-target-bottom::after {
	content: '';
	position: absolute;
	bottom: -1px;
	left: 0;
	right: 0;
	height: 2px;
	background-color: var(--text-color-primary);
	z-index: 20;
}

.action-key-underline {
	text-decoration: underline;
	text-decoration-color: var(--text-color-secondary);
}
</style>
