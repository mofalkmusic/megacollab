<template>
	<div v-bind="$attrs" class="audio-file-pool-root" ref="dropZoneWrapper">
		<div class="options-and-controls">
			<div style="display: flex; gap: 1rem">
				<UploadButton />
			</div>

			<div style="display: flex; gap: 1rem" class="dim small">
				<p>Total Files: {{ audiofiles.size }}</p>
				<p>Total Clips: {{ clips.size }}</p>
			</div>
		</div>

		<div class="clips-container">
			<div v-for="audioFile in sortedAudioFiles" :key="audioFile.id">
				<ClipInstance
					:audiofile="audioFile"
					:custom-width-px="AUDIO_POOL_WIDTH"
					:style="{ height: '7rem' }"
				/>
			</div>
		</div>

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
import { audiofiles, clips, user, AUDIO_POOL_WIDTH } from '@/state'
import UploadButton from '@/components/UploadButton.vue'
import { computed, useTemplateRef } from 'vue'
import type { AudioFile } from '@/types'
import ClipInstance from '@/components/ClipInstance.vue'
import { useDropZone } from '@vueuse/core'
import { File } from 'lucide-vue-next'
import { audioMimeTypes } from '~/constants'
import { optimisticAudioCreateUpload } from '@/utils/uploadAudio'
import { useToast } from '@/composables/useToast'

const { addToast } = useToast()

const dropZoneEl = useTemplateRef('dropZoneWrapper')

const { files, isOverDropZone } = useDropZone(dropZoneEl, {
	multiple: true,
	dataTypes: audioMimeTypes,
	preventDefaultForUnhandled: true,
	onDrop: async (files) => {
		if (!files || !files.length) return

		const res = await Promise.all(
			files.map(async (file) => {
				const { success, duration, id, reason } = await optimisticAudioCreateUpload(file)
				return { success, duration, id, reason, file_name: file.name }
			}),
		)

		res.forEach((r) => {
			if (!r.success) {
				addToast({
					type: 'notification',
					title: 'File Upload Failed',
					message: `${r.file_name}: ${r.reason || 'Unknown reason'}`,
					icon: 'warning',
					lifetimeMs: 5000,
					priority: 'medium',
				})
			}
		})
	},
})

const sortedAudioFiles = computed(() => {
	const owned: (AudioFile & { deletable: boolean })[] = []
	const foreign: (AudioFile & { deletable: boolean })[] = []
	for (const f of audiofiles.values()) {
		if (f.creator_user_id === user.value?.id) owned.push({ ...f, deletable: true })
		else foreign.push({ ...f, deletable: false })
	}
	const byDate = (a: AudioFile, b: AudioFile) =>
		new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
	return [...owned.sort(byDate), ...foreign.sort(byDate)]
})
</script>

<style scoped>
.audio-file-pool-root {
	display: grid;
	grid-template-rows: auto 1fr;
	background-color: var(--bg-color);
	z-index: 15;
	border-top: 1px solid var(--border-primary);
	position: relative;
	overflow: hidden;
	padding: 1rem;
	gap: 1rem;
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
</style>
