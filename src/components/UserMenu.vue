<template>
	<div class="user-menu-container">
		<div v-if="!isEditingUsername" class="inner-menu-wrap">
			<button class="default-button user-menu-btn" @click="startEditingUsername">
				<UserPen class="dim" :size="22" style="grid-area: logo" />
				<p style="grid-area: name">
					{{ user?.display_name }}
				</p>
				<p class="small dim" style="line-height: 120%; grid-area: email">
					{{ user?.provider_email }}
				</p>
			</button>

			<div
				style="
					border-top: 1px solid var(--border-primary);
					margin-top: 0.5rem;
					padding-bottom: 0.5rem;
				"
			></div>

			<button class="default-button menu-btn" @click="emits('onUndo')">
				<Undo2 class="dim" :size="16" :stroke-width="2" />
				<p>Undo</p>
				<div class="shortcut-container mono">
					<p class="kbd" :class="{ active: controlKeyPressed }">Ctrl</p>
					<p class="kbd" :class="{ active: zKeyPressed }">Z</p>
				</div>
			</button>

			<button class="default-button menu-btn" @click="emits('onSendChat')">
				<MessageSquareShare class="dim" :size="14" :stroke-width="2" />
				<p>Send Chat</p>
				<div class="shortcut-container mono">
					<p class="kbd" :class="{ active: tKeyPressed }">T</p>
				</div>
			</button>

			<div
				style="
					border-top: 1px solid var(--border-primary);
					margin-top: 0.5rem;
					padding-bottom: 0.5rem;
				"
			></div>
			<button class="default-button menu-btn" @click="openBugReport" v-element-hover="onBugHover">
				<Bug class="dim" :size="15" :stroke-width="2" />
				<p>Report a Bug</p>
				<ExternalLink
					class="dim"
					style="margin-left: auto; transition: opacity 0.1s"
					:size="16"
					:style="{ opacity: isBugButtonHovered ? 1 : 0 }"
				/>
			</button>
			<button class="default-button menu-btn">
				<Settings2 class="dim" :size="16" :stroke-width="2" />
				<p>Settings</p>
			</button>
			<button class="default-button menu-btn" @click="signout">
				<LogOut class="dim" :size="15" :stroke-width="2" />
				<p>Sign Out</p>
			</button>
		</div>
		<div v-else class="inner-menu-wrap" style="padding: 1rem; padding-top: 0.8rem">
			<div style="display: flex; align-items: center; justify-content: space-between">
				<label class="txt bold" for="username" style="margin-bottom: 0.4rem">Username</label>
				<p class="small dim mono">{{ tempUsername.length }}/32</p>
			</div>

			<form @submit.prevent="confirmEditingUsername" style="padding: 0; margin: 0; display: grid">
				<input
					type="text"
					class="textInput txt mono small"
					v-model="tempUsername"
					id="username"
					style="margin-bottom: 0.7rem"
					@keydown.space.stop
					maxlength="32"
					:disabled="isUpdating"
					:style="{
						color: errorMessage ? 'color-mix(in lch, red 80%, var(--text-color-primary))' : '',
						border: errorMessage ? '1px solid red' : '',
					}"
				/>
			</form>
			<p class="small dim">You can change your username at any time.</p>
			<p v-if="errorMessage" class="small" style="color: red">{{ errorMessage }}</p>
			<div style="display: flex; gap: 1rem; justify-content: flex-end; margin-top: 2rem">
				<button
					class="default-button secondary"
					@click="cancelEditingUsername"
					:disabled="isUpdating"
				>
					Cancel
				</button>
				<button
					class="default-button"
					ref="confirmBtn"
					@click="confirmEditingUsername"
					:disabled="isUpdating"
					:style="{ width: lockedWidth ? `${lockedWidth}px` : '' }"
				>
					<p v-if="!isUpdating">Confirm</p>
					<LoaderCircle v-else :size="16" :stroke-width="2.4" class="spin" />
				</button>
			</div>
		</div>
	</div>
</template>

<script setup lang="ts">
import { socket } from '@/socket/socket'
import { user, controlKeyPressed, zKeyPressed, tKeyPressed } from '@/state'
import {
	UserPen,
	Settings2,
	LogOut,
	LoaderCircle,
	Undo2,
	MessageSquareShare,
	Bug,
	ExternalLink,
} from 'lucide-vue-next'
import { nextTick, shallowRef, useTemplateRef, watch } from 'vue'
import { useRouter } from 'vue-router'
import { sanitizeLetterUnderscoreOnly } from '~/utils'
import { vElementHover } from '@vueuse/components'
import { isPlaying, reset } from '@/audioEngine'

const isBugButtonHovered = shallowRef(false)
function onBugHover(hovered: boolean) {
	isBugButtonHovered.value = hovered
}

const router = useRouter()
const inDev = import.meta.env.MODE === 'development'

function signout() {
	if (isPlaying.value) {
		reset()
	}

	if (inDev) {
		router.push('/login')
		return
	}

	window.location.href = '/api/auth/signout'
}

function openBugReport() {
	window.open('https://github.com/mofalkmusic/megacollab/issues', '_blank')
}

const isEditingUsername = shallowRef(false)
const emits = defineEmits<{
	(e: 'onUpdated'): void
	(e: 'onUndo'): void
	(e: 'onSendChat'): void
}>()

async function cancelEditingUsername() {
	if (isUpdating.value) return
	isEditingUsername.value = false
	tempUsername.value = user?.value?.display_name ?? ''
	errorMessage.value = null

	await nextTick()
	emits('onUpdated')
}

const lockedWidth = shallowRef<number | null>(null)
const isUpdating = shallowRef(false)

const confirmBtn = useTemplateRef('confirmBtn')
const errorMessage = shallowRef<string | null>(null)

async function confirmEditingUsername() {
	lockedWidth.value = confirmBtn.value?.getBoundingClientRect().width ?? null
	isUpdating.value = true

	const cleanUsername = sanitizeLetterUnderscoreOnly(tempUsername.value.trim().toLowerCase(), false)

	const res = await socket.emitWithAck('get:update:username', {
		username: cleanUsername,
	})

	if (!res.success) {
		errorMessage.value = res.error.message
		isUpdating.value = false
		lockedWidth.value = null
		return
	}

	tempUsername.value = res.data.username

	if (user.value) {
		user.value.display_name = res.data.username
	}

	isEditingUsername.value = false
	isUpdating.value = false
	lockedWidth.value = null

	emits('onUpdated')
}

const tempUsername = shallowRef<string>(user?.value?.display_name ?? '')

watch(
	() => tempUsername.value,
	() => {
		errorMessage.value = null
		tempUsername.value = sanitizeLetterUnderscoreOnly(tempUsername.value.toLowerCase(), false)
	},
)

async function startEditingUsername() {
	isEditingUsername.value = true
	errorMessage.value = null
	await nextTick()
	emits('onUpdated')
}
</script>

<style scoped>
.user-menu-container {
	display: grid;
	background-color: color-mix(in lch, var(--bg-color), white 10%);
	border-radius: 0.75rem;
	border: 1px solid var(--border-primary);
}

.inner-menu-wrap {
	display: grid;
	border-radius: inherit;
	padding: 0.5rem;
	max-width: 20rem;
	box-shadow: 0px 0px 1rem 0rem var(--bg-color);
}

.user-menu-btn {
	background-color: transparent;
	display: grid;
	height: unset;
	gap: unset;
	box-shadow: none;
	grid-template-columns: auto 1fr;
	padding-top: 0.3rem;
	padding-bottom: 0.7rem;
	max-width: inherit;

	grid-template-areas: 'logo name' 'logo email';
	column-gap: 0.8rem;
	padding-left: 0.9rem;
}

.user-menu-btn:hover {
	background-color: color-mix(in lch, transparent, white 15%);
	box-shadow: none;
}

.user-menu-btn > p {
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	max-width: inherit;
}

.menu-btn {
	background-color: transparent;
	box-shadow: none;
	justify-content: flex-start;
	white-space: nowrap;
}

.menu-btn:hover {
	background-color: color-mix(in lch, transparent, white 15%);
	box-shadow: none;
}

.compound-input-wrap {
	background-color: transparent;
	height: auto;
	padding-top: 0.4rem;
	padding-bottom: 0.4rem;
	cursor: default;
	width: 100%;
}

.compound-input-wrap:hover {
	background-color: transparent;
}

.range-input-wrap {
	height: 3rem;
	background-color: color-mix(in lch, transparent, white 15%);
	border-radius: 0.5rem;
	width: 100%;
	display: flex;
	justify-content: space-between;
	align-items: center;
	padding: 0 0.1rem;
}

.range-input-button {
	background-color: transparent;
	border: none;
	cursor: pointer;
	border-radius: inherit;
	height: 100%;
	aspect-ratio: 1/1;
	padding: 0;
	display: flex;
	align-items: center;
	justify-content: center;
	color: var(--text-color-secondary);

	transition: color 0.1s;
}

.range-input-button:hover {
	color: var(--text-color-primary);
}
</style>
