<template>
	<button
		class="no-select add-track-button"
		:class="{ 'is-dragging-clip': !!dragFromPoolState }"
		style="grid-area: addtrack"
		@click="addTrack"
	>
		<div class="add-track-button-content">
			<Plus :size="20" stroke-width="2" />
			<p style="color: inherit">Add Track</p>
		</div>
	</button>
</template>

<script setup lang="ts">
import { Plus } from 'lucide-vue-next'
import { socket } from '@/socket/socket'
import { tracks, dragFromPoolState } from '@/state'
import { useToast } from '@/composables/useToast'
import type { ClientTrack } from '~/schema'

const { addToast } = useToast()

const emits = defineEmits<{ (e: 'onTrackAdded', track: ClientTrack): void }>()

const addTrack = async () => {
	// could be done optimistically but for now is fast enough I think...
	const { success, error, data } = await socket.emitWithAck('get:track:create', null)

	if (!success) {
		addToast({
			type: 'notification',
			message: error.message,
			icon: 'warning',
			priority: 'high',
			title: 'Failed to create track',
		})
		console.error(error)
		return
	}

	tracks.set(data.id, data)
	emits('onTrackAdded', data)
}
</script>

<style scoped>
.add-track-button {
	height: 7rem;
	display: flex;
	align-items: center;
	justify-content: flex-start;

	background-color: var(--bg-color);
	border: none;

	border-bottom: 1px dashed var(--border-primary);
	border-top: 1px dashed var(--border-primary);
	cursor: pointer;
	margin-bottom: 2rem;

	transition:
		background-color 50ms,
		color 50ms;

	position: relative;
	color: var(--text-color-secondary);
	padding: 0;

	box-shadow: none;
	border-radius: 0;
}

.add-track-button.is-dragging-clip {
	cursor: default;
}

.add-track-button:not(.is-dragging-clip):hover {
	background-color: color-mix(in lch, var(--bg-color), white 15%);
	color: var(--text-color-primary);
	box-shadow: none;
	border-radius: 0;
}

.add-track-button::before {
	content: '';
	box-sizing: border-box;
	position: sticky;
	top: 0;
	left: 0;
	z-index: 1;

	height: 100%;
	width: calc(11rem + 1px);
	flex-shrink: 0;
	background-color: transparent;

	border-right: 1px dashed var(--border-primary);
}

.add-track-button-content {
	color: inherit;
	position: sticky;
	left: 50%;
	transform: translateX(-50%);
	display: flex;
	align-items: center;
	gap: 0.7rem;
	justify-content: center;
}
</style>
