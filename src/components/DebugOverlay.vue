<template>
	<div
		v-bind="$attrs"
		v-if="debugEntries.size"
		class="debugWrap small mono"
		ref="debugWrap"
		:style="style"
	>
		<div ref="handle" class="handle">
			<GripVertical :size="16" />
		</div>
		<div class="debug-inner-container">
			<div v-for="entry in debugEntries.values()" :key="entry.id" class="debug-entry">
				<div v-if="entry.label" class="txt mono debug-label small">#{{ entry.label }}</div>
				<pre class="debug-content small" style="color: limegreen">{{ entry.data }}</pre>
			</div>
		</div>
	</div>
</template>

<script setup lang="ts">
import { debugEntries } from '@/state'
import { onMounted, useTemplateRef } from 'vue'
import {
	useDraggable,
	useElementSize,
	useWindowSize,
	type Position,
	until,
	watchDebounced,
} from '@vueuse/core'
import { GripVertical } from 'lucide-vue-next'

const STORAGE_KEY = 'DEBUG_OVERLAY_POSITION'

const debugWrapEl = useTemplateRef('debugWrap')
const handleEl = useTemplateRef('handle')

const { width: windowW, height: windowH } = useWindowSize({})
const { width: wrapW, height: wrapH } = useElementSize(debugWrapEl)

const { x, y, style } = useDraggable(debugWrapEl, {
	initialValue: simpleLoadPosition(),
	preventDefault: true,
	handle: handleEl,
	onEnd: (pos) => {
		applyBounds(pos)
		savePosition(pos)
	},
	onMove: (pos) => applyBounds(pos),
})

onMounted(async () => {
	await until(wrapH).not.toBe(0)
	await until(wrapW).not.toBe(0)
	applyBounds({ x: x.value, y: y.value })
})

watchDebounced(
	[windowW, windowH],
	() => {
		applyBounds({ x: x.value, y: y.value })
	},
	{ debounce: 200 },
)

function simpleLoadPosition() {
	let pos = { x: 10, y: 100 }

	const posStr = localStorage.getItem(STORAGE_KEY)
	if (!posStr || typeof posStr !== 'string') return pos

	try {
		pos = JSON.parse(posStr)
		return pos
	} catch (err) {
		console.error('[DEBUG] Error parsing position', err)
		localStorage.removeItem(STORAGE_KEY)
		return pos
	}
}

function applyBounds(pos: Position) {
	const maxX = windowW.value - wrapW.value
	const maxY = windowH.value - wrapH.value
	x.value = Math.max(Math.min(pos.x, maxX), 0)
	y.value = Math.max(Math.min(pos.y, maxY), 0)
}

function savePosition(pos: Position) {
	localStorage.setItem(STORAGE_KEY, JSON.stringify({ x: x.value, y: y.value }))
}
</script>

<style scoped>
.debugWrap {
	background: #000000;
	color: #2df72d;

	white-space: pre-wrap;

	position: fixed;
	left: 0;
	top: 0;
	z-index: 9000;

	width: max-content;
	display: grid;
	grid-template-columns: auto 1fr;
	opacity: 0.6;
}

.handle {
	cursor: grab;
	color: var(--text-color-secondary);
	height: 1.6rem;
	width: 1.6rem;
	position: relative;
	top: 6px;
	left: 1px;
	color: color-mix(in oklab, var(--bg-color), var(--text-color-secondary));
}

.handle::before {
	content: '';
	position: absolute;
	left: -2px;
	right: -10px;
	top: -8px;
	bottom: -18px;
	/* background-color: rgba(255, 0, 0, 0.2); */
}

.handle:active {
	cursor: grabbing;
}

.debug-inner-container {
	display: grid;
	padding: 1rem 1.2rem;
}

.debug-entry {
	margin-bottom: 0.7rem;
	border-bottom: 1px solid color-mix(in oklab, var(--bg-color), var(--text-color-secondary));
	padding-bottom: 0.5rem;
}

.debug-entry:last-child {
	border-bottom: none;
	padding-bottom: 0;
	margin-bottom: 0;
}

.debug-label {
	color: #fff;
	font-weight: bold;
	margin-bottom: 2px;
}

/* .debug-content {} */
</style>
