<template>
	<div v-bind="$attrs" class="track-instance">
		<div
			ref="trackElement"
			class="track"
			:style="trackStyle"
			:data-track-id="props.track.id"
			@contextmenu.prevent
		>
			<ClipInstance
				v-for="clip in trackClips"
				:key="clip.id"
				:clip="clip"
				:audiofile="audiofiles.get(clip.audio_file_id)!"
				:style="{
					position: 'absolute',
					height: '100%',
				}"
			/>

			<!-- visual drop indicator -->
			<div
				v-if="isOverDropZone && dropIndicatorX !== null"
				class="drop-indicator"
				:style="{ left: `${dropIndicatorX}px` }"
			></div>
		</div>
	</div>
</template>

<script setup lang="ts">
import type { ServerTrack, Clip } from '~/schema'
import ClipInstance from '@/components/ClipInstance.vue'
import { computed, onMounted, onUnmounted, shallowRef, useTemplateRef } from 'vue'
import { clips, pxPerBeat, audiofiles, pxTrackHeight, TOTAL_BEATS, user } from '@/state'
import { registerTrack, unregisterTrack } from '@/audioEngine'
import { useDropZone, useEventListener, useElementBounding } from '@vueuse/core'
import { audioMimeTypes } from '~/constants'
import { optimisticAudioCreateUpload } from '@/utils/uploadAudio'
import { px_to_beats, quantize_beats, sec_to_beats, beats_to_px } from '@/utils/mathUtils'
import { socket } from '@/socket/socket'
import { nanoid } from 'nanoid'
import { useGlobalProgress } from '@/composables/useGlobalProgress'

const props = defineProps<{
	track: ServerTrack
}>()

onMounted(() => registerTrack(props.track.id, props.track.gain))

onUnmounted(() => unregisterTrack(props.track.id))

const trackStyle = computed(() => {
	const lineColor = 'var(--_minor-line-color)'
	return {
		height: `${pxTrackHeight}px`,
		background: `
            repeating-linear-gradient(
                90deg,
                ${lineColor} 0px 1px,
                transparent 1px,
                transparent ${pxPerBeat.value}px
            )`,
	}
})

const trackClips = computed(() => {
	return [...clips.values()].filter((clip) => clip.track_id === props.track.id)
})

const trackEl = useTemplateRef('trackElement')
const dropIndicatorX = shallowRef<number | null>(null)

const { isOverDropZone } = useDropZone(trackEl, {
	dataTypes: audioMimeTypes,
	preventDefaultForUnhandled: false,
	multiple: true, // but knida false :D
	onDrop: async (files, event) => {
		if (!files || files.length === 0) return
		const file = files[0]
		if (!file) return

		if (!user.value?.id) return

		if (dropIndicatorX.value === null) return
		let startBeat = px_to_beats(dropIndicatorX.value)

		if (!event?.altKey) {
			startBeat = quantize_beats(startBeat)
		}

		startBeat = Math.max(0, startBeat)
		startBeat = Math.min(startBeat, TOTAL_BEATS - 1)

		const progressGlob = useGlobalProgress()
		const res = await optimisticAudioCreateUpload(
			file,
			(p) => {
				progressGlob.update(p)
			},
			true,
		)

		if (res.success && res.uploadPromise) {
			res.uploadPromise.finally(() => progressGlob.done())
		} else {
			progressGlob.done()
		}

		if (!res.success) {
			return console.warn(res.reason)
		}

		// optimistic clip
		const tempId = `__temp__${nanoid()}`
		const durationBeats = sec_to_beats(res.duration)
		let endBeat = startBeat + durationBeats
		endBeat = Math.min(endBeat, TOTAL_BEATS)

		const tempClip: Clip = {
			id: tempId,
			track_id: props.track.id,
			audio_file_id: res.id,
			creator_user_id: user.value.id,
			start_beat: startBeat,
			end_beat: endBeat,
			offset_seconds: 0,
			gain: 1,
			created_at: new Date().toISOString(),
		}

		clips.set(tempId, tempClip)

		// wait for upload
		if (res.uploadPromise) {
			try {
				await res.uploadPromise

				const currentClip = clips.get(tempId)
				if (!currentClip) return // deleted?

				const syncRes = await socket.emitWithAck('get:clip:create', {
					audio_file_id: res.id,
					track_id: currentClip.track_id,
					start_beat: currentClip.start_beat,
					end_beat: currentClip.end_beat,
					offset_seconds: currentClip.offset_seconds,
					gain: currentClip.gain,
				})

				if (syncRes.success) {
					clips.delete(tempId)
					clips.set(syncRes.data.id, syncRes.data)
				}
			} catch (e) {
				console.error('Upload or sync failed', e)
				clips.delete(tempId)
			}
		}
	},
})

const { left: trackLeft } = useElementBounding(trackEl)

// Track mouse position relative to track for indicator
useEventListener(trackEl, 'dragover', (e: DragEvent) => {
	if (!isOverDropZone.value) return
	e.preventDefault() // Allow drop

	const rawX = e.clientX - trackLeft.value
	const rawBeat = px_to_beats(rawX)
	const beat = e.altKey ? rawBeat : quantize_beats(rawBeat)
	dropIndicatorX.value = beats_to_px(beat)
})
</script>

<style scoped>
.track-instance {
	--_line-color: hsl(0, 0%, 28%);
	--_minor-line-color: hsl(0, 0%, 13%);

	border-bottom: 1px solid var(--_line-color);
	position: relative;
	display: grid;
	grid-template-columns: 1fr;
	height: 7rem;
}

.track-instance:last-child {
	border-bottom: none;
}

.track {
	width: 100%;
	height: inherit;
	position: relative;
}

.drop-indicator {
	position: absolute;
	top: 0;
	bottom: 0;
	width: 10rem;
	background: linear-gradient(to right, yellowgreen, transparent 80%);
	z-index: 10;
	pointer-events: none;
}
</style>
