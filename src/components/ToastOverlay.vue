<template>
	<div class="toast-overlay" :style="{ bottom: `calc(${audioFilePoolHeightPx}px + 2rem)` }">
		<ToastItem v-for="(toast, index) in toasts" :key="toast.id" :toast="toast" :index="index" />
	</div>
</template>

<script setup lang="ts">
import { toasts, audioFilePoolHeightPx } from '@/state'
import ToastItem from './ToastItem.vue'
</script>

<style scoped>
.toast-overlay {
	position: fixed;
	right: 2.6rem;
	z-index: 9999;
	display: flex;
	flex-direction: column;
	pointer-events: none;
	padding-bottom: 1.2rem;
	gap: 1rem;

	height: max-content;
	width: max-content;
	transition: bottom 0.3s ease;
}
</style>
