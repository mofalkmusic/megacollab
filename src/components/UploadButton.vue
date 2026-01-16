<template>
	<button
		v-bind="$attrs"
		@click="openFileDialog"
		ref="uploadButton"
		class="no-select default-button upload-button"
		:disabled="isUploading"
		:class="{ progress: progressMap.size }"
		:style="styles"
	>
		<FolderOpen v-if="!isUploading" :size="16" :stroke-width="2.4" />
		<LoaderCircle v-else :size="16" :stroke-width="2.4" class="spin" />
		<p>{{ buttonText }}</p>
	</button>
</template>

<script setup lang="ts">
import { useFileDialog, useTimeoutFn } from '@vueuse/core'
import { audioMimeTypes } from '~/constants'
import { optimisticAudioCreateUpload } from '@/utils/uploadAudio'
import { computed, ref, shallowRef, useTemplateRef, type CSSProperties } from 'vue'
import { FolderOpen, LoaderCircle } from 'lucide-vue-next'
import { useGlobalProgress } from '@/composables/useGlobalProgress'
import { useConsole } from '@/composables/useConsole'

import { user } from '@/state'

function openFileDialog() {
	if (user.value?.banned_at) return
	if (isUploading.value) return
	open()
}

const { userLog } = useConsole()

const buttonEl = useTemplateRef<HTMLButtonElement>('uploadButton')
const lockedWidth = ref<number | null>(null)

const buttonText = shallowRef<string>('Upload Audio')

const overallProgress = computed(() => {
	if (progressMap.value.size === 0) return 0
	let total = 0
	progressMap.value.forEach((v) => (total += v))
	return total / progressMap.value.size
})

const styles = computed((): CSSProperties => {
	return {
		width: lockedWidth.value ? `${lockedWidth.value}px` : '',
		justifyContent: 'flex-start',
		'--progress': `${overallProgress.value}%`,
	}
})

const { open, onChange, reset } = useFileDialog({
	accept: audioMimeTypes.join(', '),
	multiple: true,
})

const progressMap = ref<Map<string, number>>(new Map())
const isUploading = shallowRef(false)

onChange(async (files) => {
	if (!files) return reset()

	lockedWidth.value = buttonEl.value?.getBoundingClientRect().width ?? null
	buttonText.value = 'Uploading...'
	isUploading.value = true

	const filesArray = Array.from(files)

	const res = await Promise.all(
		filesArray.map(async (file) => {
			progressMap.value.set(file.name, 0)
			const progressGlob = useGlobalProgress()
			const { success, duration, id, reason, uploadPromise } =
				await optimisticAudioCreateUpload(file, (progress) => {
					progressMap.value.set(file.name, progress)
					progressGlob.update(progress)
				})
			if (uploadPromise) {
				uploadPromise.finally(() => progressGlob.done())
			} else {
				progressGlob.done()
			}

			return { success, duration, id, reason, file_name: file.name }
		}),
	)

	buttonText.value = 'Uploaded!'
	isUploading.value = false

	res.map((res) => {
		if (res.success) return
		progressMap.value.delete(res.file_name)

		userLog('UPLOAD', `File upload failed: ${res.file_name}: ${res.reason}`, {
			textColor: 'red',
		})
	})

	reset()

	useTimeoutFn(() => {
		progressMap.value.clear()
		lockedWidth.value = null
		buttonText.value = 'Upload Audio'
	}, 2000)
})
</script>

<style scoped>
.upload-button {
	position: relative;
	overflow: hidden;
}

.upload-button > * {
	position: relative;
	z-index: 1;
}

.upload-button:disabled {
	cursor: not-allowed;
}

.progress::after {
	content: '';
	position: absolute;
	left: 0;
	top: 0;
	bottom: 0;
	width: var(--progress);
	background: color-mix(in lch, white, transparent 80%);
	pointer-events: none;
	z-index: 0;
	transition: width 0.2s linear;
}
</style>
