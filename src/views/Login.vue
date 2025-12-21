<template>
	<div v-if="inDev" class="custom-grid">
		<div class="inner-container">
			<div class="content">
				<p class="bold big caps">no auth</p>
				<p class="small dim" style="margin-bottom: 2rem">in developer mode</p>
				<button class="default-button" @click="$router.push('/')">
					<ArrowLeft :size="16" />
					<p>Go to home</p>
				</button>
			</div>
		</div>
	</div>

	<div v-else class="custom-grid">
		<div class="inner-container">
			<div class="content">
				<div class="logo"></div>
				<p class="bold big" style="text-align: center; margin-bottom: 0.7rem">MEGACOLLAB</p>

				<p class="dim" style="text-align: center; margin-bottom: 2.4rem">
					Please sign in to continue.
				</p>
				<div style="display: grid; gap: 0.8rem; grid-template-columns: 1fr 1fr; width: 100%">
					<button class="default-button" @click="signInWithTwitch">
						<Twitch style="height: 16px; width: 16px" />
						<p>Twitch</p>
					</button>
					<button class="default-button" @click="signInWithDiscord">
						<Discord style="height: 16px; width: 16px" />
						<p>Discord</p>
					</button>
				</div>

				<div v-if="successMessage && !errorMessage" class="error-alert success-alert">
					<CheckCircle :size="15" />
					<p class="small">{{ successMessage }}</p>
				</div>

				<div v-if="errorMessage" class="error-alert" :key="errorKey">
					<AlertCircle :size="15" />
					<p class="small">{{ errorMessage }}</p>
				</div>

				<div class="divider">
					<div class="divider-line"></div>
					<p
						class="txt small"
						style="
							color: color-mix(in lch, var(--text-color-secondary), black 20%);
							position: relative;
							top: -1px;
						"
					>
						or
					</p>
					<div class="divider-line"></div>
				</div>

				<form @submit.prevent="" style="display: grid; width: 100%">
					<label class="txt dim" for="email" style="margin-bottom: 0.4rem"
						><Lock :size="14" style="position: relative; top: 1px" /> Email Address</label
					>
					<input
						class="textInput txt mono small"
						disabled
						style="margin-bottom: 0.7rem"
						type="text"
						placeholder="Coming soon..."
						id="email"
					/>
				</form>
			</div>

			<div class="footer">
				<p class="txt small dim">
					<span style="display: inline-flex; align-items: center; margin-right: 0.6rem"
						><Info :size="10" /></span
					>By signing in, you agree to our <a href="/terms">Terms of Service</a> and
					<a href="/privacy">Privacy Policy</a>.
				</p>
			</div>
		</div>
	</div>
</template>

<script setup lang="ts">
import { Info, Lock, AlertCircle, CheckCircle, ArrowLeft } from 'lucide-vue-next'
import { shallowRef, computed, ref } from 'vue'
import { useRoute } from 'vue-router'
import Twitch from '@/components/icons/Twitch.vue'
import Discord from '@/components/icons/Discord.vue'

const route = useRoute()
const localError = ref<string | null>(null)
const errorKey = ref(0)

function handleError(msg: string) {
	localError.value = msg
	errorKey.value++
}

const errorMessage = computed(() => {
	if (localError.value) return localError.value

	const error = route.query.error
	const description = route.query.error_description

	if (!error) return null

	const descStr = Array.isArray(description) ? description[0] : description
	return descStr || 'An unknown error occurred during login. Please try again.'
})

const successMessage = computed(() => {
	const success = route.query.success
	return Array.isArray(success) ? success[0] : success
})

async function signInWithTwitch() {
	localError.value = null
	try {
		const res = await fetch('/api/auth/twitch/url')
		if (!res.ok) {
			console.error(res.status, res.statusText)
			try {
				const data = await res.json()
				handleError(data.error || `Error: ${res.statusText}`)
			} catch {
				handleError(`Error: ${res.statusText}`)
			}
			return
		}

		const data = await res.json()
		window.location.href = data.url
	} catch (err) {
		console.error(err)
		handleError('Failed to connect to the server.')
	}
}

async function signInWithDiscord() {
	localError.value = null
	try {
		const res = await fetch('/api/auth/discord/url')
		if (!res.ok) {
			console.error(res.status, res.statusText)
			try {
				const data = await res.json()
				handleError(data.error || `Error: ${res.statusText}`)
			} catch {
				handleError(`Error: ${res.statusText}`)
			}
			return
		}

		const data = await res.json()
		window.location.href = data.url
	} catch (err) {
		console.error(err)
		handleError('Failed to connect to the server.')
	}
}

const inDev = shallowRef<boolean>(import.meta.env.MODE === 'development')
</script>

<style scoped>
.custom-grid {
	--window-w-max-width: 32rem;
	padding-bottom: 4rem;
	align-items: center;
	background-color: var(--bg-color);

	opacity: 1;

	--size: 19rem;
	--c1: color-mix(in lch, var(--bg-color), black 10%);
	--c2: color-mix(in lch, var(--bg-color), white 3%);

	background:
		conic-gradient(from 45deg at 75% 75%, var(--c1) 25%, var(--c2) 0 50%, #0000 0) 0 0 / var(--size)
			var(--size),
		conic-gradient(from 225deg at 25% 25%, var(--c2) 25%, var(--c1) 0 50%, #0000 0) 0 0 /
			var(--size) var(--size),
		repeating-conic-gradient(var(--c2) 0 25%, var(--c1) 0 50%) 0 0 / calc(2 * var(--size))
			calc(2 * var(--size));
}

.inner-container {
	background-color: color-mix(in lch, var(--border-primary), var(--bg-color) 60%);
	border: 1px solid var(--border-primary);
	border-radius: 1rem;
	width: 100%;
	display: grid;
}

.logo {
	background-image: url('/favicon3.png');
	background-size: contain;
	background-repeat: no-repeat;
	background-position: center;
	width: 4rem;
	height: 4rem;
	aspect-ratio: 1/1;
	margin-bottom: 1.5rem;
}

@keyframes wiggle {
	0%,
	100% {
		transform: translateX(0);
	}
	15% {
		transform: translateX(-4px);
	}
	30% {
		transform: translateX(4px);
	}
	45% {
		transform: translateX(-4px);
	}
	60% {
		transform: translateX(4px);
	}
	75% {
		transform: translateX(-4px);
	}
}

.error-alert {
	background-color: color-mix(in lch, #ef4444, transparent 85%);
	border: 1px solid #ef4444;
	color: #ef4444;
	padding: 0.6rem 1rem;
	border-radius: 0.5rem;
	display: flex;
	align-items: center;
	gap: 0.8rem;
	margin-top: 1.5rem;
	font-size: 0.9rem;
	width: 100%;
	animation: wiggle 0.4s ease-in-out;
}

.success-alert {
	background-color: color-mix(in lch, #10b981, transparent 85%);
	border: 1px solid #10b981;
	color: #10b981;
	width: 100%;
	animation: wiggle 0.4s ease-in-out;
}

.content {
	padding: 3rem 2rem;
	width: 100%;
	display: grid;
	justify-items: center;

	/* border-radius: inherit;
	border-bottom-left-radius: 0;
	border-bottom-right-radius: 0; */
}

.footer {
	background-color: color-mix(in lch, var(--border-primary), var(--bg-color) 76%);
	border-top: 1px solid var(--border-primary);
	border-radius: 0;
	border-bottom-left-radius: inherit;
	border-bottom-right-radius: inherit;
	width: 100%;
	padding: 2rem;
	display: grid;
}

a {
	text-decoration: underline;
	color: var(--text-color-secondary);
	font-weight: 500;
	transition: color 100ms;
}

a:hover {
	color: var(--text-color-primary);
}

.divider {
	display: grid;
	grid-template-columns: 1fr auto 1fr;
	align-items: center;
	gap: 0.8rem;
	width: 100%;
	margin: 1.7rem 0;
}

.divider-line {
	width: 100%;
	height: 1px;
	background-color: var(--border-primary);
}
</style>
