<template>
	<div v-bind="$attrs" class="audio-file-pool-root" ref="dropZoneWrapper">
		<div class="options-and-controls">
			<div style="display: flex; gap: 1rem; align-items: center">
				<UploadButton :disabled="!!dragFromPoolState" />

				<input
					v-model="searchQuery"
					type="text"
					placeholder="Search samples..."
					class="textInput secondary txt mono small"
					style="width: 200px"
					:disabled="!!dragFromPoolState"
				/>
			</div>

			<div class="pool-stats">
				<div class="stat-group" title="Total Audio Files">
					<AudioLines stroke-width="1.8" class="stat-icon audio-lines" />
					<p class="no-select dim">{{ audiofiles.size }}</p>
				</div>
				<div class="stat-group" title="Total Clips in Playlist">
					<LayoutDashboard stroke-width="1.8" class="stat-icon dashboard" />
					<p class="no-select dim">
						{{ clips.size }}
					</p>
				</div>
			</div>
		</div>

		<div class="clips-container" ref="clipsContainer" :class="{ panning: isPanning }">
			<div v-for="audioFile in sortedAudioFiles" :key="audioFile.id">
				<ClipInstance
					:audiofile="audioFile"
					:deletable="audioFile.deletable"
					:custom-width-px="AUDIO_POOL_WIDTH"
					:style="{ height: '7rem' }"
				/>
			</div>
		</div>

		<!-- custom scrollbar -->
		<CustomScrollbar
			class="pool-scrollbar-x"
			orientation="x"
			:scroll-container="clipsContainerEl"
		/>

		<div v-if="isOverDropZone" class="is-over">
			<div class="drop-zone-text">
				<p class="big bold" style="color: yellowgreen">Drop your files here!</p>
				<div style="position: relative">
					<File
						style="
							color: yellowgreen;
							position: absolute;
							top: 50%;
							left: 50%;
							transform: translate(-80%, -50%) rotate(-12deg);
						"
					/>
					<File
						style="
							color: yellowgreen;
							position: absolute;
							top: 50%;
							left: 50%;
							transform: translate(0%, -50%) scale(1.2);
						"
					/>
					<File
						style="
							color: yellowgreen;
							position: absolute;
							top: 50%;
							left: 50%;
							transform: translate(80%, -50%) rotate(12deg);
						"
					/>
				</div>
			</div>
		</div>
	</div>
</template>

<script setup lang="ts">
import {
	audiofiles,
	clips,
	user,
	AUDIO_POOL_WIDTH,
	audioFilePoolHeightPx,
	dragFromPoolState,
} from '@/state'
import UploadButton from '@/components/UploadButton.vue'
import { computed, shallowRef, useTemplateRef, watchEffect, ref, watch } from 'vue'
import type { AudioFile } from '@/types'
import ClipInstance from '@/components/ClipInstance.vue'
import { useDropZone, useElementSize, useEventListener, useResizeObserver } from '@vueuse/core'
import CustomScrollbar from '@/components/CustomScrollbar.vue'
import { File, AudioLines, LayoutDashboard } from 'lucide-vue-next'
import { audioMimeTypes } from '~/constants'
import { optimisticAudioCreateUpload } from '@/utils/uploadAudio'
import { useGlobalProgress } from '@/composables/useGlobalProgress'
import { useConsole } from '@/composables/useConsole'
import Fuse from 'fuse.js'

const { userLog } = useConsole()

const dropZoneEl = useTemplateRef('dropZoneWrapper')

const { height } = useElementSize(dropZoneEl, { width: 0, height: 0 }, { box: 'border-box' })

watchEffect(() => {
	audioFilePoolHeightPx.value = height.value
})

const { files, isOverDropZone } = useDropZone(dropZoneEl, {
	multiple: true,
	dataTypes: audioMimeTypes,
	preventDefaultForUnhandled: true,
	onDrop: async (files) => {
		if (user.value?.banned_at) return
		if (!files || !files.length) return

		const res = await Promise.all(
			files.map(async (file) => {
				const progress = useGlobalProgress()
				const { success, duration, id, reason, uploadPromise } =
					await optimisticAudioCreateUpload(file, (p) => {
						progress.update(p)
					})

				if (uploadPromise) {
					uploadPromise.finally(() => progress.done())
				} else {
					progress.done()
				}

				return { success, duration, id, reason, file_name: file.name }
			}),
		)

		res.forEach((r) => {
			if (!r.success) {
				userLog(
					'SYSTEM',
					`Upload Failed: ${r.file_name} - ${r.reason || 'Unknown reason'}`,
					{
						textColor: 'red',
						isBold: true,
					},
				)
			} else {
				userLog('SYSTEM', `Uploaded: ${r.file_name}`, {
					textColor: 'green',
				})
			}
		})
	},
})

const searchQuery = shallowRef('')

const sortedAudioFiles = computed(() => {
	const owned: (AudioFile & { deletable: boolean })[] = []
	const foreign: (AudioFile & { deletable: boolean })[] = []

	const query = searchQuery.value.trim().toLowerCase()
	const audioFilesList = Array.from(audiofiles.values())

	let filesToShow = audioFilesList

	if (query) {
		const fuse = new Fuse(audioFilesList, {
			keys: [
				{ name: 'file_name', weight: 0.8 },
				{ name: 'creator_display_name', weight: 0.2 },
			],
			threshold: 0.25,
			isCaseSensitive: false,
			shouldSort: true,
			findAllMatches: true,
		})

		filesToShow = fuse.search(query).map((result) => result.item)
	}

	for (const f of filesToShow) {
		if (f.creator_user_id === user.value?.id) owned.push({ ...f, deletable: true })
		else foreign.push({ ...f, deletable: false })
	}

	const byDate = (a: AudioFile, b: AudioFile) =>
		new Date(b.created_at).getTime() - new Date(a.created_at).getTime()

	return [...owned.sort(byDate), ...foreign.sort(byDate)]
})

const clipsContainerEl = useTemplateRef('clipsContainer')
const isPanning = shallowRef(false)

useEventListener(clipsContainerEl, 'pointerdown', (e) => {
	if (e.button !== 1) return // wheel-click only

	const container = clipsContainerEl.value
	if (!container) return

	// prevent default browser behavior
	e.preventDefault()

	const startX = e.clientX
	const startScrollLeft = container.scrollLeft

	if (!(e.target instanceof HTMLElement)) return // better pattern than type assertion

	const target = e.target
	target.setPointerCapture(e.pointerId)
	isPanning.value = true

	const onMove = (moveEvent: PointerEvent) => {
		if (!clipsContainerEl.value) return
		const deltaX = moveEvent.clientX - startX
		clipsContainerEl.value.scrollLeft = startScrollLeft - deltaX
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
</script>

<style scoped>
.audio-file-pool-root {
	display: grid;
	grid-template-rows: auto 1fr auto;
	background-color: var(--bg-color);
	z-index: 15;
	border-top: 1px solid var(--border-primary);
	position: relative;
	overflow: hidden;
	padding: 1rem;
	padding-bottom: 0;
	gap: 1rem;
}

.pool-stats {
	display: grid;
	grid-template-columns: auto auto;
	align-items: center;
	gap: 1.4rem;
}

.stat-group {
	display: flex;
	align-items: center;
	justify-content: flex-start;
}

.stat-icon {
	margin-right: 0.5rem;
}

.stat-icon.audio-lines {
	height: 1.7rem;
	width: 1.7rem;
}

.stat-icon.dashboard {
	transform: rotate(90deg);
	height: 1.6rem;
	width: 1.6rem;
}

.clips-container.panning {
	cursor: grabbing !important;
}

.is-over {
	display: grid;
	position: absolute;
	inset: 0;
	user-select: none;
	pointer-events: none;
	background-color: var(--bg-color);
	z-index: 5;
	padding: 1rem;
}

.drop-zone-text {
	display: flex;
	justify-content: center;
	align-items: center;
	flex-direction: column;
	padding: 1rem 1.4rem;
	border: 1px dashed yellowgreen;
	border-radius: 1rem;
	background-color: rgba(153, 205, 50, 0.2);
	box-shadow:
		inset 0px 0px 50px -30px yellowgreen,
		0px 0px 30px -20px yellowgreen;
	gap: 2.4rem;

	animation: slightbgpulse 1.6s infinite;
}

@keyframes slightbgpulse {
	0% {
		background-color: rgba(153, 205, 50, 0.2);
	}

	50% {
		background-color: rgba(153, 205, 50, 0.3);
	}

	100% {
		background-color: rgba(153, 205, 50, 0.2);
	}
}

.options-and-controls {
	width: 100%;
	display: flex;
	justify-content: flex-start;
	gap: 2rem;
	align-items: center;
}

.clips-container {
	display: grid;
	grid-template-rows: repeat(2, 1fr);
	grid-auto-flow: column;
	justify-content: start;
	gap: 1rem;
	overflow-x: auto;
	overflow-y: hidden;
	min-height: 0;

	/* Hide scrollbar for all browsers */
	scrollbar-width: none;
	/* Firefox */
	-ms-overflow-style: none;
}

.clips-container::-webkit-scrollbar {
	display: none;
	/* Chrome, Safari, Opera */
}

.pool-scrollbar-x {
	height: 1.2rem;
	width: 100%;
	margin-left: -1rem;
	width: calc(100% + 2rem);
}
</style>
