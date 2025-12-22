<template>
	<div class="custom-grid" style="justify-items: center; align-items: center; padding-bottom: 4rem">
		<div
			v-if="rateLimitError"
			style="display: grid; justify-items: center; gap: 1rem; text-align: center"
		>
			<p style="color: #ef4444">Rate Limit Exceeded</p>
			<p v-if="secondsRemaining > 0">
				Please wait {{ secondsRemaining }} seconds before reconnecting...
			</p>
			<p v-else>Connecting...</p>
		</div>
		<div v-else style="display: grid; justify-items: center; gap: 1rem">
			<p>Connecting to server...</p>
			<Loader2 class="spin" :size="18" />
		</div>
	</div>
</template>

<script setup lang="ts">
import { Loader2 } from 'lucide-vue-next'
import { socket } from '@/socket/socket'
import { computed, watch } from 'vue'
import { useNow } from '@vueuse/core'

const now = useNow()

const rateLimitError = computed(() => {
	if (socket.error.value?.status === 'RATE_LIMIT_EXCEEDED') {
		return socket.error.value
	}
	return null
})

const secondsRemaining = computed(() => {
	if (!rateLimitError.value) return 0
	const ms = rateLimitError.value.tryAgainAtMs - now.value.getTime()
	return Math.max(0, Math.ceil(ms / 1000))
})

watch(secondsRemaining, (secs) => {
	if (secs <= 0 && rateLimitError.value) {
		socket.error.value = null
		socket.connect()
	}
})
</script>
