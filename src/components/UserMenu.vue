<template>
	<div class="user-menu-container">
		<div v-if="!isEditingUsername" class="inner-menu-wrap">
			<button class="user-menu-btn" @click="startEditingUsername">
				<UserPen class="dim" :size="22" style="grid-area: logo" />
				<p style="grid-area: name">
					{{ user?.display_name }}
				</p>
				<p class="small dim" style="line-height: 120%; grid-area: email">{{ user?.email }}</p>
			</button>

			<div
				style="
					border-top: 1px solid var(--border-primary);
					margin-top: 0.5rem;
					padding-bottom: 0.5rem;
				"
			></div>

			<button class="menu-btn" @click="emits('onUndo')">
				<Undo2 class="dim" :size="16" :stroke-width="2" />
				<p>Undo</p>
				<div class="shortcut-container mono">
					<p class="kbd" :class="{ active: controlKeyPressed }">Ctrl</p>
					<p class="kbd" :class="{ active: zKeyPressed }">Z</p>
				</div>
			</button>

			<div
				style="
					border-top: 1px solid var(--border-primary);
					margin-top: 0.5rem;
					padding-bottom: 0.5rem;
				"
			></div>
			<button class="menu-btn">
				<Settings2 class="dim" :size="16" :stroke-width="2" />
				<p>Settings</p>
			</button>
			<button class="menu-btn" @click="signout">
				<LogOut class="dim" :size="16" :stroke-width="2" />
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
					class="txt mono small"
					v-model="tempUsername"
					id="username"
					style="margin-bottom: 0.7rem"
					@keydown.space.stop
					maxlength="32"
					:disabled="isUpdating"
				/>
			</form>
			<p class="small dim">You can change your username at any time.</p>
			<p v-if="errorMessage" class="small" style="color: red">{{ errorMessage }}</p>
			<div style="display: flex; gap: 1rem; justify-content: flex-end; margin-top: 2rem">
				<button class="secondary" @click="cancelEditingUsername" :disabled="isUpdating">
					Cancel
				</button>
				<button
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
import { user, controlKeyPressed, zKeyPressed } from '@/state'
import { UserPen, Settings2, LogOut, LoaderCircle, Undo2, History } from 'lucide-vue-next'
import { nextTick, shallowRef, useTemplateRef, watch } from 'vue'
import { sanitizeLetterUnderscoreOnly } from '~/utils'
import useClerkHelper from '@/composables/useClerkHelper'

const inDev = import.meta.env.MODE === 'development'

function signout() {
	if (inDev) return console.warn('Not signing out in dev mode')
	const { signOutUser } = useClerkHelper()
	signOutUser()
}

const isEditingUsername = shallowRef(false)
const emits = defineEmits<{ (e: 'onUpdated'): void; (e: 'onUndo'): void }>()

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
	margin-top: 0.5rem;
	border: 1px solid var(--border-primary);
}

.inner-menu-wrap {
	display: grid;
	border-radius: inherit;
	padding: 0.5rem;
	max-width: 20rem;
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
}

.menu-btn:hover {
	background-color: color-mix(in lch, transparent, white 15%);
	box-shadow: none;
}

input {
	min-width: 0;
	max-width: 100%;
	height: 3rem;
	border-radius: 0.5rem;
	border: none;
	padding: 0 1rem;
	background-color: color-mix(in lch, var(--border-primary), black 0%);
}

input:disabled {
	color: var(--text-color-secondary);
	background-color: color-mix(in lch, var(--border-primary), black 10%);
}

input:focus-visible:not(:disabled) {
	outline: none;
	box-shadow: 0px 0px 0px 1px color-mix(in lch, var(--border-primary), white 30%);
}
</style>
