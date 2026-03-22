<template>
	<div v-bind="$attrs" class="track-instance" :style="{ height: `${pxTrackHeight}px` }">
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
				:scroll-x="scrollX"
				:timeline-window-width="timelineWindowWidth"
				:parent-track-el="trackEl"
				:style="{
					position: 'absolute',
					height: 'calc(100% - 1px)',
				}"
			/>

			<ChatStickyNote
				v-for="chat in trackChats"
				:key="chat.id"
				:chat="chat"
				@reply="startReply"
			/>

			<ChatStickyNote
				v-for="chat in trackTempChats"
				:key="chat.id"
				:chat="chat"
				@cancel="tempChats.delete(chat.id)"
				@created="handleTempChatCreated(chat, $event)"
			/>

			<ChatStickyNote v-if="ghostChatForTrack" :chat="ghostChatForTrack" :is-ghost="true" />

			<!-- visual drop indicator -->
			<div
				v-if="isOverDropZone && dropIndicatorX !== null"
				class="drop-indicator"
				:style="{ left: `${dropIndicatorX}px` }"
			></div>

			<!-- mute overlays -->
			<div
				v-if="
					mutedTrackIds.has(props.track.id) ||
					(soloTrackIds.size > 0 && !soloTrackIds.has(props.track.id))
				"
				class="mute-overlay"
			></div>
		</div>
	</div>
</template>

<script setup lang="ts">
import type { TrackServer, ClipClient, ChatClient } from '~/schema'
import ClipInstance from '@/components/ClipInstance.vue'
import ChatStickyNote from '@/components/ChatStickyNote.vue'
import { computed, onMounted, onUnmounted, shallowRef, useTemplateRef } from 'vue'
import {
	clips,
	pxPerBeat,
	audiofiles,
	pxTrackHeight,
	TOTAL_BEATS,
	user,
	chats,
	tempChats,
	isPlacingChat,
	timelineCursorPayload,
} from '@/state'
import { altKeyPressed } from '@/utils/globalHotKeys'
import { mutedTrackIds, registerTrack, soloTrackIds, unregisterTrack } from '@/audioEngine'
import { useDropZone, useEventListener, useElementBounding } from '@vueuse/core'
import { audioMimeTypes } from '~/constants'
import { optimisticAudioCreateUpload } from '@/utils/uploadAudio'
import { px_to_beats, quantize_beats, sec_to_beats, beats_to_px } from '@/utils/mathUtils'
import { socket } from '@/socket/socket'
import { nanoid } from 'nanoid'
import { useGlobalProgress } from '@/composables/useGlobalProgress'
import { useConsole } from '@/composables/useConsole'
import { useTimelineGrid } from '@/composables/useTimelineGrid'
import type { transform } from 'zod'

const props = defineProps<{
	track: TrackServer
	scrollX: number
	timelineWindowWidth: number
	isLast?: boolean
}>()

const { userLog } = useConsole()
const { gridBackground } = useTimelineGrid()

onMounted(() => registerTrack(props.track.id))

onUnmounted(() => unregisterTrack(props.track.id))

const trackStyle = computed(() => {
	if (props.isLast) {
		return {
			height: `${pxTrackHeight}px`,
			background: gridBackground.value,
		}
	}

	const bottomBorderLayer = `linear-gradient(to top, var(--_line-color) 0px, var(--_line-color) 1px, transparent 1px)`

	return {
		height: `${pxTrackHeight}px`,
		background: `${bottomBorderLayer}, ${gridBackground.value}`,
	}
})

const trackClips = computed(() => {
	return [...clips.values()].filter((clip) => clip.track_id === props.track.id)
})

const trackChats = computed(() => {
	return [...chats.values()].filter((chat) => chat.track_id === props.track.id)
})

const trackTempChats = computed(() => {
	return [...tempChats.values()].filter((chat) => chat.track_id === props.track.id)
})

const ghostChatForTrack = computed(() => {
	if (
		!isPlacingChat.value ||
		!timelineCursorPayload.value ||
		timelineCursorPayload.value.trackId !== props.track.id
	)
		return null
	return {
		id: '__ghost__',
		beat: timelineCursorPayload.value.beat,
		track_id: props.track.id,
		track_y_offset: timelineCursorPayload.value.trackYOffset,
		text: 'Click to drop a message...',
		reply_to_id: null,
		creator_user_id: user.value!.id,
		creator_display_name: user.value!.display_name,
		color: user.value!.color || '#ffffff',
		created_at: new Date().toISOString(),
	} satisfies ChatClient
})

async function handleTempChatCreated(tempChat: ChatClient, newText: string) {
	tempChats.delete(tempChat.id)

	try {
		const res = await socket.emitWithAck('get:chat:create', {
			beat: tempChat.beat,
			track_id: tempChat.track_id,
			track_y_offset: tempChat.track_y_offset,
			text: newText.trim().slice(0, 100),
			reply_to_id: tempChat.reply_to_id,
		})

		if (res.success) {
			chats.set(res.data.id, res.data)

			userLog('CHAT', res.data.text, {
				textColor: res.data.color,
				display_name: res.data.creator_display_name,
				user_id: res.data.creator_user_id,
				reply_to_id: res.data.reply_to_id,
			})
		} else {
			userLog('SYSTEM', 'Failed to send chat: ' + res.error.message, { textColor: 'red' })
		}
	} catch (e) {
		userLog('SYSTEM', 'Network error sending chat', { textColor: 'red' })
	}
}

function startReply(replyToChat: ChatClient) {
	const tempId = `__temp__${nanoid()}`

	const c: ChatClient = {
		id: tempId,
		beat: replyToChat.beat,
		track_id: replyToChat.track_id,
		track_y_offset: Math.min(1, replyToChat.track_y_offset + 0.6),
		text: '',
		reply_to_id: replyToChat.id,
		creator_user_id: user.value!.id,
		creator_display_name: user.value!.display_name,
		color: user.value!.color || '#ffffff',
		created_at: new Date().toISOString(),
	} satisfies ChatClient

	tempChats.set(tempId, c)
}

const trackEl = useTemplateRef('trackElement')
const dropIndicatorX = shallowRef<number | null>(null)

const { isOverDropZone } = useDropZone(trackEl, {
	preventDefaultForUnhandled: false,
	multiple: true, // but knida false :D
	onDrop: async (files, event) => {
		if (!files || files.length === 0) return

		const validFiles = []
		for (const f of files) {
			if (audioMimeTypes.includes(f.type)) {
				validFiles.push(f)
			} else {
				userLog('SYSTEM', `File format not supported: ${f.type}`, {
					textColor: 'red',
					isBold: true,
				})
			}
		}

		if (!validFiles.length) return
		const file = validFiles[0]
		if (!file) return

		if (!user.value?.id) return

		if (dropIndicatorX.value === null) return
		let startBeat = px_to_beats(dropIndicatorX.value)

		if (!altKeyPressed.value) {
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

		const tempClip: ClipClient = {
			id: tempId,
			track_id: props.track.id,
			audio_file_id: res.id,
			creator_user_id: user.value.id,
			creator_display_name: user.value.display_name,
			start_beat: startBeat,
			end_beat: endBeat,
			offset_seconds: 0,
			fade_in_sec: 0,
			fade_out_sec: 0,
			is_muted: false,
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

				const syncRes = await socket.emitWithAck('get:clip:create', [
					{
						audio_file_id: res.id,
						track_id: currentClip.track_id,
						start_beat: currentClip.start_beat,
						end_beat: currentClip.end_beat,
						offset_seconds: currentClip.offset_seconds,
						gain: currentClip.gain,
					},
				])

				if (syncRes.success && syncRes.data[0]) {
					clips.delete(tempId)
					clips.set(syncRes.data[0].id, syncRes.data[0])
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
	const beat = altKeyPressed.value ? rawBeat : quantize_beats(rawBeat)
	dropIndicatorX.value = beats_to_px(beat)
})
</script>

<style scoped>
.track-instance {
	--_line-color: hsl(0, 0%, 28%);

	position: relative;
	display: grid;
	grid-template-columns: 1fr;
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

.mute-overlay {
	position: absolute;
	inset: 0;
	bottom: 1px;
	background-color: rgba(0, 0, 0, 0.5);
	z-index: 5;
	pointer-events: none;
}
</style>
