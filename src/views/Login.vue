<template>
	<!-- important, to not call any clerk injects which wont be available in dev mode -->
	<div v-if="inDev" style="padding: 3rem">
		<button @click="$router.push('/')">back to index</button>
		<p>no auth</p>
		<p class="small">in developer mode</p>
	</div>

	<div v-else class="custom-grid" style="align-items: center">
		<div style="display: grid">
			<button @click="signInWithTwitch">Sign in with twitch</button>
		</div>
	</div>
</template>

<script setup lang="ts">
import { shallowRef } from 'vue'

async function signInWithTwitch() {
	const res = await fetch('/api/auth/twitch/url')
	if (!res.ok) throw res.json()

	const data = await res.json()
	window.location.href = data.url
}

const inDev = shallowRef<boolean>(import.meta.env.MODE === 'development')
</script>

<style scoped></style>
