<script setup lang="ts">
import { activeTool, type ToolMode } from '@/state'
import { Hand, Paintbrush, Sparkles, Scissors, VolumeX } from 'lucide-vue-next'
import { useEventListener } from '@vueuse/core'

const tools: {
	mode: ToolMode
	icon: typeof Hand
	label: string
	shortcut: string
	color: string
}[] = [
	{ mode: 'hand', icon: Hand, label: 'Hand', shortcut: 'H', color: 'var(--text-color-primary)' },
	{ mode: 'brush', icon: Paintbrush, label: 'Brush', shortcut: 'B', color: '#4fb8ff' },
	{ mode: 'magic-brush', icon: Sparkles, label: 'Magic Brush', shortcut: 'G', color: '#ffb347' },
	{ mode: 'slice', icon: Scissors, label: 'Slice', shortcut: 'C', color: '#ff6b6b' },
	{ mode: 'mute', icon: VolumeX, label: 'Mute', shortcut: '0', color: '#b9bec8' },
]

useEventListener(window, 'keydown', (e) => {
	// Don't intercept when typing in inputs
	if (
		(e.target as HTMLElement).tagName === 'INPUT' ||
		(e.target as HTMLElement).tagName === 'TEXTAREA'
	)
		return
	if (e.ctrlKey || e.metaKey || e.altKey) return

	if (e.key.toLowerCase() === 'h') activeTool.value = 'hand'
	if (e.key.toLowerCase() === 'b') activeTool.value = 'brush'
	if (e.key.toLowerCase() === 'g') activeTool.value = 'magic-brush'
	if (e.key.toLowerCase() === 'c') activeTool.value = 'slice'
	if (e.key === '0') activeTool.value = 'mute'
})
</script>

<template>
	<div class="toolbar">
		<button
			v-for="tool in tools"
			:key="tool.mode"
			class="controls-panel-btn toolbar-btn"
			:class="[{ active: activeTool === tool.mode }, `tool-${tool.mode}`]"
			:title="`${tool.label} (${tool.shortcut})`"
			:style="{ '--tool-color': tool.color }"
			@click="activeTool = tool.mode"
		>
			<component :is="tool.icon" :size="16" />
		</button>
	</div>
</template>

<style scoped>
.toolbar {
	display: flex;
	align-items: center;
	gap: 0;
	margin-left: 1rem;
}

.toolbar-btn {
	border-left: none;
	color: var(--text-color-primary);
	transition:
		box-shadow 120ms,
		background-color 150ms,
		color 120ms;
}

.toolbar-btn:first-child {
	border-left: 1px solid var(--border-primary);
}

.toolbar-btn.active {
	z-index: 21;
	color: var(--tool-color);
	box-shadow:
		0px 0px 34px -14px var(--tool-color),
		inset 0px 0px 6px -2px var(--tool-color),
		inset 0px 0px 18px -7px var(--tool-color);
}

.toolbar-btn.active :deep(svg) {
	filter: drop-shadow(0 0 0.3rem color-mix(in lch, var(--tool-color), transparent 60%));
}
</style>
