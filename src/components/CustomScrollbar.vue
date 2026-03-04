<template>
	<div
		class="custom-scrollbar"
		:class="[`scrollbar-${orientation}`, { 'is-dragging': isScrollbarPressed }]"
		ref="scrollbarRef"
		v-bind="$attrs"
	>
		<div
			class="custom-thumb"
			:class="`thumb-${orientation}`"
			ref="thumbRef"
			:style="thumbStyle"
		></div>
	</div>
</template>

<script setup lang="ts">
import { computed, ref, shallowRef, useTemplateRef, watch, watchEffect } from 'vue'
import {
	useMouseInElement,
	useMousePressed,
	useEventListener,
	useResizeObserver,
	useMutationObserver,
	useScroll,
} from '@vueuse/core'

defineOptions({
	inheritAttrs: false,
})

const props = withDefaults(
	defineProps<{
		orientation?: 'x' | 'y'
		scrollContainer?: HTMLElement | null
	}>(),
	{
		orientation: 'x',
	},
)

const scrollbarRef = useTemplateRef('scrollbarRef')
const thumbRef = useTemplateRef('thumbRef')

const {
	elementX: scrollbarMouseX,
	elementY: scrollbarMouseY,
	elementWidth: scrollbarWidth,
	elementHeight: scrollbarHeight,
} = useMouseInElement(scrollbarRef)
const { pressed: isScrollbarPressed } = useMousePressed({ target: scrollbarRef })

const { x: scrollX, y: scrollY } = useScroll(() => props.scrollContainer)

const scrollWidth = ref(0)
const scrollHeight = ref(0)
const clientWidth = ref(0)
const clientHeight = ref(0)

function updateDims() {
	const el = props.scrollContainer
	if (!el) {
		scrollWidth.value = 0
		scrollHeight.value = 0
		clientWidth.value = 0
		clientHeight.value = 0
		return
	}
	scrollWidth.value = el.scrollWidth
	scrollHeight.value = el.scrollHeight
	clientWidth.value = el.clientWidth
	clientHeight.value = el.clientHeight
}

useResizeObserver(() => props.scrollContainer, updateDims)

useMutationObserver(
	() => props.scrollContainer,
	() => {
		updateDims()
	},
	{ childList: true, subtree: true, characterData: true, attributes: true },
	// might be a bit intense for the playlist, but otherwise should be fine? i think so.
	// todo: evaluate this pls mo
)

watch(() => props.scrollContainer, updateDims, { immediate: true })

const dragOffset = shallowRef(0)

// initial click
watch(isScrollbarPressed, (pressed) => {
	if (!pressed || !thumbRef.value || !scrollbarRef.value) return

	const thumbRect = thumbRef.value.getBoundingClientRect()
	const trackRect = scrollbarRef.value.getBoundingClientRect()

	if (props.orientation === 'x') {
		const thumbWidth = thumbRect.width
		const thumbRelativeLeft = thumbRect.left - trackRect.left
		const mouseRelativeTimestamp = scrollbarMouseX.value

		const clickIsInsideThumb =
			mouseRelativeTimestamp >= thumbRelativeLeft &&
			mouseRelativeTimestamp <= thumbRelativeLeft + thumbWidth

		if (clickIsInsideThumb) {
			dragOffset.value = thumbRelativeLeft - mouseRelativeTimestamp
		} else {
			dragOffset.value = -(thumbWidth / 2)
			updateScrollPosition()
		}
	} else {
		const thumbHeight = thumbRect.height
		const thumbRelativeTop = thumbRect.top - trackRect.top
		const mouseRelativeTimestamp = scrollbarMouseY.value

		const clickIsInsideThumb =
			mouseRelativeTimestamp >= thumbRelativeTop &&
			mouseRelativeTimestamp <= thumbRelativeTop + thumbHeight

		if (clickIsInsideThumb) {
			dragOffset.value = thumbRelativeTop - mouseRelativeTimestamp
		} else {
			dragOffset.value = -(thumbHeight / 2)
			updateScrollPosition()
		}
	}
})

useEventListener(scrollbarRef, 'pointerdown', (event) => {
	if (!(event.target instanceof HTMLElement)) return
	event.target.setPointerCapture(event.pointerId)
})

useEventListener(scrollbarRef, 'pointerup', (event) => {
	if (!(event.target instanceof HTMLElement)) return
	event.target.releasePointerCapture(event.pointerId)
})

watchEffect(() => {
	if (isScrollbarPressed.value) {
		updateScrollPosition()
	}
})

useEventListener('resize', () => {
	updateScrollPosition()
})

function updateScrollPosition() {
	const container = props.scrollContainer
	if (!container || !thumbRef.value || !scrollbarRef.value || !isScrollbarPressed.value) return

	if (props.orientation === 'x') {
		const thumbWidth = thumbRef.value.clientWidth
		const trackWidth = scrollbarWidth.value

		const scrollableWidth = trackWidth - thumbWidth
		if (scrollableWidth > 0) {
			const targetLeft = scrollbarMouseX.value + dragOffset.value
			const clampedLeft = Math.max(0, Math.min(scrollableWidth, targetLeft))
			const ratio = clampedLeft / scrollableWidth

			container.scrollLeft = ratio * (container.scrollWidth - container.clientWidth)
		}
	} else {
		const thumbHeight = thumbRef.value.clientHeight
		const trackHeight = scrollbarHeight.value

		const scrollableHeight = trackHeight - thumbHeight
		if (scrollableHeight > 0) {
			const targetTop = scrollbarMouseY.value + dragOffset.value
			const clampedTop = Math.max(0, Math.min(scrollableHeight, targetTop))
			const ratio = clampedTop / scrollableHeight

			container.scrollTop = ratio * (container.scrollHeight - container.clientHeight)
		}
	}
}

const thumbStyle = computed(() => {
	const el = props.scrollContainer
	if (!el) return { width: '0%', left: '0%', height: '0%', top: '0%' }

	if (props.orientation === 'x') {
		const scrollW = scrollWidth.value || el.scrollWidth
		const visibleW = clientWidth.value || el.clientWidth

		if (scrollW <= visibleW || scrollW === 0) return { width: '100%', left: '0%' }

		const left = (scrollX.value / scrollW) * 100
		const widthPercent = (visibleW / scrollW) * 100
		return { width: `${widthPercent}%`, left: `${left}%` }
	} else {
		const scrollH = scrollHeight.value || el.scrollHeight
		const visibleH = clientHeight.value || el.clientHeight

		if (scrollH <= visibleH || scrollH === 0) return { height: '100%', top: '0%' }

		const top = (scrollY.value / scrollH) * 100
		const heightPercent = (visibleH / scrollH) * 100
		return { height: `${heightPercent}%`, top: `${top}%` }
	}
})

defineExpose({
	updateDims,
})
</script>

<style scoped>
.custom-scrollbar {
	background-color: color-mix(in lch, var(--bg-color), white 5%);
	position: relative;
	cursor: pointer;
	overflow: hidden;
	z-index: 15;
}

.custom-scrollbar.is-dragging {
	cursor: grabbing !important;
}

.custom-scrollbar.is-dragging .custom-thumb {
	cursor: grabbing !important;
}

.custom-thumb {
	background-color: color-mix(in lch, var(--bg-color), white 20%);
	position: absolute;
	cursor: grab;
}

.thumb-x {
	top: 0;
	height: 100%;
	transition:
		width 50ms linear,
		left 50ms linear;
	will-change: width, left;
}

.thumb-y {
	left: 0;
	width: 100%;
	transition:
		height 50ms linear,
		top 50ms linear;
	will-change: height, top;
}
</style>
