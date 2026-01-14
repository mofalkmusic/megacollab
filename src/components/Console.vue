<template>
	<div
		class="console-wrapper"
		:style="{
			height: `${audioFilePoolHeightPx}px`,
			width: `min(${audioFilePoolHeightPx * 1.25}px, 50vw)`,
		}"
	>
		<div class="console-container" ref="containerRef">
			<div class="console-content" ref="contentRef">
				<div v-if="!messages.length" class="empty-state">
					<span class="small mono dim">Console loading...</span>
				</div>
				<TransitionGroup name="message-slide">
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
				</TransitionGroup>
			</div>
		</div>

		<!-- to bottom button -->
		<Transition name="fade">
			<button v-if="showScrollToBottom" class="scroll-to-bottom-btn" @click="scrollToBottom">
				↓ New messages
			</button>
		</Transition>

		<!-- custom scrollbar -->
		<div class="custom-scrollbar scrollbar-y">
			<div
				v-show="isScrollable"
				class="custom-thumb thumb-y"
				:style="{ height: `${scrollIndicatorY.height}%`, top: `${scrollIndicatorY.top}%` }"
			></div>
		</div>
	</div>
</template>

<script setup lang="ts">
import { useConsole } from '@/composables/useConsole'
import { computed, nextTick, ref, shallowRef, useTemplateRef, watch } from 'vue'
import { audioFilePoolHeightPx } from '@/state'
import { useResizeObserver, useScroll } from '@vueuse/core'

// todo: style the button for scroll to bottom properly

const { messages } = useConsole()
const containerRef = useTemplateRef('containerRef')
const contentRef = useTemplateRef('contentRef')

const { y: scrollY, arrivedState } = useScroll(containerRef)
const containerClientHeight = ref(0)
const scrollHeight = ref(0)

function updateScrollDims() {
	if (containerRef.value) {
		scrollHeight.value = containerRef.value.scrollHeight
		containerClientHeight.value = containerRef.value.clientHeight
	}
}

useResizeObserver(contentRef, updateScrollDims)
useResizeObserver(containerRef, updateScrollDims)

const isScrollable = computed(() => {
	return scrollHeight.value > containerClientHeight.value && scrollHeight.value > 0
})

const scrollIndicatorY = computed(() => {
	const scrollH = scrollHeight.value
	const visibleH = containerClientHeight.value

	if (!isScrollable.value) return { height: 0, top: 0 }

	const top = (scrollY.value / scrollH) * 100
	const heightPercent = (visibleH / scrollH) * 100
	return { height: heightPercent, top }
})

const isAtBottom = computed(() => arrivedState.bottom)
const showScrollToBottom = shallowRef(false)

function scrollToBottom() {
	if (containerRef.value) {
		containerRef.value.scrollTo({
			top: containerRef.value.scrollHeight,
			behavior: 'smooth',
		})
	}
}

let wasScrollable = false

watch(
	() => messages.value[messages.value.length - 1]?.id,
	async () => {
		const currentlyScrollable = isScrollable.value

		if (isAtBottom.value || !wasScrollable) {
			await nextTick()
			if (containerRef.value) {
				containerRef.value.scrollTop = containerRef.value.scrollHeight
			}
		} else if (currentlyScrollable) {
			showScrollToBottom.value = true
		}

		wasScrollable = currentlyScrollable
	},
)

watch(isAtBottom, (atBottom) => {
	if (atBottom) {
		showScrollToBottom.value = false
	}
})
</script>

<style scoped>
.console-wrapper {
	position: relative;
	display: flex;
	border-left: 1px solid var(--border-primary);
	border-top: 1px solid var(--border-primary);
	background-color: var(--bg-color-dark, #111);
}

.console-container {
	overflow-y: scroll;
	padding: 0.5rem;
	font-family: monospace;
	font-size: 0.85rem;
	height: 100%;
	width: 100%;

	/* Hide scrollbar for all browsers */
	scrollbar-width: none;
	-ms-overflow-style: none;
}

.console-container::-webkit-scrollbar {
	display: none;
}

.console-content {
	display: flex;
	flex-direction: column;
	min-height: 100%;
	justify-content: flex-end;
	gap: 0.1rem;
}

.empty-state {
	padding: 0.5rem;
	font-style: italic;
}

.console-message {
	padding: 0.2rem 0.4rem;
	border-radius: 4px;
	align-items: baseline;
	line-height: 1.2;
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

/* Custom Scrollbar Styles */
.custom-scrollbar {
	background-color: color-mix(in lch, var(--bg-color), white 5%);
	position: relative;
	width: 1.5rem;
	height: 100%;
	flex-shrink: 0;
	/* border-left: 1px solid var(--border-primary); */
}

.custom-thumb {
	background-color: color-mix(in lch, var(--bg-color), white 20%);
	position: absolute;
	width: 100%;
	left: 0;
	transition:
		height 50ms linear,
		top 50ms linear;
	will-change: height, top;
}

/* Scroll to bottom button */
.scroll-to-bottom-btn {
	position: absolute;
	bottom: 1rem;
	left: 50%;
	transform: translateX(-50%);
	background-color: var(--accent-color, #4a9eff);
	color: white;
	border: none;
	border-radius: 1rem;
	padding: 0.4rem 0.8rem;
	font-size: 0.75rem;
	font-family: inherit;
	cursor: pointer;
	box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
	z-index: 10;
	transition:
		background-color 150ms ease,
		transform 150ms ease;
}

.scroll-to-bottom-btn:hover {
	background-color: color-mix(in lch, var(--accent-color, #4a9eff), white 15%);
	transform: translateX(-50%) scale(1.05);
}

/* Fade transition */
.fade-enter-active,
.fade-leave-active {
	transition: opacity 200ms ease;
}

.fade-enter-from,
.fade-leave-to {
	opacity: 0;
}

.message-slide-enter-active {
	transition:
		opacity 100ms ease,
		transform 400ms ease;
}

.message-slide-enter-from {
	opacity: 0;
	transform: translateX(1.2rem);
}
</style>
