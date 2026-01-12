<template>
	<div style="width: 100%">
		<Transition name="dissapear">
			<div v-if="isVisible" class="global-loading-indicator">
				<div
					class="progress-bar"
					:style="{ width: `${10 + averageProgress * 0.9}%` }"
				></div>
			</div>
		</Transition>
	</div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { globalProgresses } from '@/state'

const isVisible = computed(() => globalProgresses.size > 0)

const averageProgress = computed(() => {
	const progresses = [...globalProgresses.values()]
	if (progresses.length === 0) return 0
	const total = progresses.reduce((sum, item) => sum + item.progress, 0)
	return total / progresses.length
})
</script>
<style scoped>
.global-loading-indicator {
	width: 100%;
	height: 2px;
	z-index: 70;
	background-color: var(--border-primary);
}

.progress-bar {
	height: 100%;
	--_c1: var(--active-playing-color);
	--_c2: color-mix(in oklab, var(--active-playing-color), rgb(0, 204, 255));

	background-image: linear-gradient(90deg, var(--_c1), var(--_c2), var(--_c1));
	background-size: 200% 200%;
	transition: width 0.3s ease;
	animation: progress-anim 1.3s linear infinite;
	will-change: width;

	position: relative;
}

.progress-bar::after {
	content: '';
	position: absolute;
	inset: 0;
	background: rgba(255, 0, 0, 1);
	filter: blur(4px);
	z-index: -1;
	background-image: linear-gradient(90deg, var(--_c1), var(--_c2), var(--_c1));
	animation: progress-anim 1.3s linear infinite;
}

@keyframes progress-anim {
	from {
		background-position: 200% 0;
	}

	to {
		background-position: 0 0;
	}
}

.dissapear-enter-active,
.dissapear-leave-active {
	transition: transform 1s;
}

.dissapear-enter-from,
.dissapear-leave-to {
	transform: scaleY(0);
}
</style>
