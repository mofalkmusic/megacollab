<template>
	<div
		v-if="!isDismissed"
		class="chat-sticky"
		:style="computedStyle"
		@contextmenu.prevent.stop="dismiss"
	>
		<div class="chat-header">
			<span class="bold smaller mono user no-select" :style="{ color: chat.color }"
				>@{{ chat.creator_display_name }}</span
			>
			<div class="actions">
				<button
					v-if="!isGhost"
					@click.stop="startReply"
					class="action-btn reply-btn"
					:class="{ 'is-hidden': isEditing }"
					:disabled="isEditing"
					title="reply"
					style="margin-right: -2px"
				>
					<Reply
						:size="14"
						style="
							color: color-mix(in lab, var(--color) 20%, var(--text-color-primary));
						"
					/>
				</button>
			</div>
		</div>
		<div v-if="isEditing" class="smaller chat-txt editing">
			<input
				ref="inputEl"
				v-model="editText"
				@keydown.enter="save"
				@keydown.esc="cancel"
				@blur="save"
				type="text"
				placeholder="Start typing..."
				autofocus
				maxlength="100"
				class="txt smaller"
			/>
		</div>
		<p v-else class="smaller chat-txt no-select">
			{{ chat.text }}
		</p>
	</div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, onMounted, useTemplateRef } from 'vue'
import { type ChatClient } from '~/schema'
import { beats_to_px } from '@/utils/mathUtils'
import { pxTrackHeight, dismissedChats } from '@/state'
import { Reply } from 'lucide-vue-next'

const props = defineProps<{
	chat: ChatClient
	isGhost?: boolean
}>()

const isDismissed = computed(() => !props.isGhost && dismissedChats.value.includes(props.chat.id))

const emit = defineEmits<{
	(e: 'created', text: string): void
	(e: 'cancel'): void
	(e: 'reply', chat: ChatClient): void
}>()

const isEditing = ref(props.chat.id.startsWith('__temp__'))
const editText = ref('')
const inputEl = useTemplateRef('inputEl')

onMounted(() => {
	if (isEditing.value) {
		nextTick(() => {
			inputEl.value?.focus()
		})
	}
})

const computedStyle = computed(() => {
	const left = beats_to_px(props.chat.beat)
	const top = props.chat.track_y_offset * pxTrackHeight

	return {
		position: 'absolute' as const,
		left: `${left}px`,
		top: `${top}px`,
		zIndex: props.isGhost ? 60 : 50,
		opacity: props.isGhost ? 0.6 : 1,
		pointerEvents: props.isGhost ? ('none' as const) : ('auto' as const),
		'--color': props.chat.color,
	}
})

function dismiss() {
	if (props.isGhost) return
	if (!dismissedChats.value.includes(props.chat.id)) {
		dismissedChats.value.push(props.chat.id)
	}
}

async function save() {
	if (!isEditing.value) return
	if (!editText.value.trim()) {
		emit('cancel')
		return
	}
	emit('created', editText.value.trim())
	isEditing.value = false
}

function cancel() {
	if (isEditing.value) {
		emit('cancel')
	}
}

function startReply() {
	emit('reply', props.chat)
}
</script>

<style scoped>
.chat-sticky {
	background: color-mix(in lab, var(--bg-color), transparent 20%);
	max-width: 18rem;
	min-width: 12rem;
	transition: opacity 0.2s ease;
	padding: 0.3rem 0.7rem;
	padding-bottom: 0.5rem;
	border: 1px solid color-mix(in lab, var(--color), transparent 70%);
	border-radius: 0.6rem;
}

.chat-header {
	display: flex;
	gap: 1rem;
	justify-content: space-between;
	align-items: center;
}

.user {
	text-overflow: ellipsis;
	overflow: hidden;
}

.actions {
	display: flex;
	gap: 6px;
	align-items: center;
	margin-left: auto;
}

.action-btn {
	background: none;
	border: none;
	color: var(--text-color-dim);
	cursor: pointer;
	padding: 0;
	margin: 0;
	display: flex;
	align-items: center;
	justify-content: center;
	position: relative;
	aspect-ratio: 1/1;
}

.action-btn:hover::after {
	background-color: color-mix(in lch, var(--text-color-primary) 13%, transparent);
}

.action-btn::after {
	content: '';
	position: absolute;
	inset: -2px;
	border-radius: 0.4rem;
}

.reply-btn.is-hidden {
	opacity: 0;
	pointer-events: none;
}

.chat-txt {
	color: color-mix(in lch, var(--text-color-primary), var(--color) 20%);
	word-wrap: break-word;
}

.chat-txt.editing {
	padding: 0;
}

.chat-txt input {
	background: var(--surface-3);
	color: color-mix(in lch, var(--text-color-primary), var(--color) 20%);
	border: 1px solid var(--border-color);
	padding: 0;
	margin: 0;
	border-radius: 4px;
	width: 100%;
	outline: none;
}

/* .chat-txt input:focus {
	border-color: var(--active-looping-color);
} */
</style>
