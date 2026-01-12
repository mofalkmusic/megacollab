<template>
	<div
		v-for="cursor in cursorsResult"
		:key="cursor.id"
		class="user-cursor"
		:style="{
			transform: `translate(${cursor.leftPx - 2}px, calc(${cursor.topPx - 1}px + 2rem))`,
			opacity: cursor.opacity,
			color: cursor.color,
		}"
	>
		<Cursor />
		<span class="txt small user-name" :style="{ backgroundColor: cursor.color }">{{
			cursor.display_name
		}}</span>
	</div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import Cursor from '@/components/icons/Cursor.vue'
import { otherUserPositions, tracks, pxTrackHeight } from '@/state'
import { CURSOR_IDLE_TIMEOUT_MS } from '~/constants'
import { beats_to_px } from '@/utils/mathUtils'
import { useNow } from '@vueuse/core'

const now = useNow({ interval: 500 })

// Helper to get sorted tracks efficiently?
const trackIdToIndex = computed(() => {
	const sorted = [...tracks.entries()].sort((a, b) => a[1].order_index - b[1].order_index)
	const map = new Map<string, number>()
	sorted.forEach(([id, _], index) => {
		map.set(id, index)
	})
	return map
})

const cursorsResult = computed(() => {
	const result: Array<{
		id: string
		leftPx: number
		topPx: number
		opacity: number
		color: string
		display_name: string
	}> = []

	const currentTime = now.value.getTime()
	const trackIndexMap = trackIdToIndex.value

	const _trackHeight = pxTrackHeight

	for (const [userId, data] of otherUserPositions) {
		const { pos, lastUpdated } = data
		const timeDiff = currentTime - lastUpdated

		// If idle for > 5s, dim to 0.5 opacity.
		// If removed from map (server timeout > 20s or clearpos), it vanishes via TransitionGroup.
		const opacity = timeDiff > CURSOR_IDLE_TIMEOUT_MS ? 0.5 : 1

		// Calc position
		const trackIndex = trackIndexMap.get(pos.trackId)
		if (trackIndex === undefined) continue // Track might be deleted or not found

		const leftPx = beats_to_px(pos.beat)

		const topPx = trackIndex * _trackHeight + pos.trackYOffset * _trackHeight

		const color = stringToColor(userId)

		result.push({
			id: userId,
			leftPx,
			topPx,
			opacity,
			color,
			display_name: data.display_name,
		})
	}
	return result
})

function stringToColor(str: string) {
	let hash = 0
	for (let i = 0; i < str.length; i++) {
		hash = str.charCodeAt(i) + ((hash << 5) - hash)
	}
	// Use HSL for nicer, more vibrant colors
	const hue = Math.abs(hash) % 360
	const saturation = 65 // High saturation for vibrancy
	const lightness = 55 // Mid lightness for good contrast
	return `hsl(${hue}, ${saturation}%, ${lightness}%)`
}
</script>

<style scoped>
.user-cursor {
	position: absolute;
	top: 0;
	left: 0;
	pointer-events: none;
	z-index: 50;
	transition:
		opacity 0.2s linear,
		transform 0.1s linear;
	will-change: transform, opacity;
}

.user-name {
	position: absolute;
	top: 10px;
	left: 14px;
	margin-top: 5px;
	padding: 2px 6px;
	border-radius: 4px;
	color: white;
	white-space: nowrap;
	pointer-events: none;
}
</style>
