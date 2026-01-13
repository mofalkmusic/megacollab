<template>
	<div
		class="console-container"
		ref="containerRef"
		:style="{ maxHeight: `${audioFilePoolHeightPx}px` }"
	>
		<div v-if="!messages.length" class="empty-state">
			<span class="small mono dim">Console loading...</span>
		</div>
		<div
			v-for="msg in messages"
			:key="msg.id"
			class="console-message"
			:style="{
				backgroundColor: msg.options?.backgroundColor,
			}"
		>
			<span class="sender mono small">{{ msg.sender }}: </span>
			<span
				class="content mono small"
				:style="{
					fontWeight: msg.options?.isBold ? 'bold' : 'normal',
					color: msg.options?.textColor,
				}"
			>
				{{ msg.text }}
			</span>
		</div>
	</div>
</template>

<script setup lang="ts">
import { useConsole } from '@/composables/useConsole'
import { nextTick, useTemplateRef, watch } from 'vue'
import { audioFilePoolHeightPx } from '@/state'

const { messages } = useConsole()
const containerRef = useTemplateRef('containerRef')

watch(
	() => messages.value.length,
	() => {
		nextTick(() => {
			if (containerRef.value) {
				containerRef.value.scrollTop = containerRef.value.scrollHeight
			}
		})
	},
)
</script>

<style scoped>
.console-container {
	border-left: 1px solid var(--border-primary);
	border-top: 1px solid var(--border-primary);
	background-color: var(--bg-color-dark, #111);
	overflow-y: auto;
	padding: 0.5rem;
	font-family: monospace;
	font-size: 0.85rem;
	display: flex;
	flex-direction: column;
	height: 100%;
	aspect-ratio: 5/4;
}

.console-container > :first-child {
	margin-top: auto;
}

.empty-state {
	padding: 0.5rem;
	font-style: italic;
}

.console-message {
	padding: 0.2rem 0.4rem;
	border-radius: 4px;
	align-items: baseline;
	line-height: 1.4;
}

.timestamp {
	font-size: 0.75rem;
	flex-shrink: 0;
	opacity: 0.6;
}

.sender {
	font-weight: 600;
}

.content {
	word-break: break-word;
}

.dim {
	opacity: 0.5;
}
</style>
