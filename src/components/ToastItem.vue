<template>
	<div ref="elementRef" v-bind="$attrs" class="toast-container" :style="{ zIndex: index }">
		<div class="toast-content" :class="[`priority-${toast.priority}`, `type-${toast.type}`]">
			<h3 v-if="toast.title" class="bold title">{{ toast.title }}</h3>
			<p class="small message">{{ toast.message }}</p>

			<div class="icon" v-if="toast.icon">
				<Mail v-if="toast.icon === 'mail'" class="svg-icon" />
				<TriangleAlert v-else-if="toast.icon === 'warning'" class="svg-icon" />
				<Info v-else-if="toast.icon === 'info'" class="svg-icon" />
				<SquareCheck v-else-if="toast.icon === 'success'" class="svg-icon" />
			</div>

			<div v-if="toast.type === 'action_request'" class="toast-actions">
				<button class="btn-deny" @click="handleDeny">
					{{ toast.onDeny.label }}
				</button>
				<button
					class="btn-confirm"
					@click="handleConfirm"
					:style="{
						'--lifetime': toast.lifetimeMs ? `${toast.lifetimeMs}ms` : undefined,
					}"
				>
					{{ toast.onConfirm.label }}
				</button>
			</div>

			<div v-if="toast.type === 'acknowledgement_request'" class="toast-actions">
				<button
					class="btn-confirm"
					@click="handleConfirm"
					:style="{
						'--lifetime': toast.lifetimeMs ? `${toast.lifetimeMs}ms` : undefined,
					}"
				>
					{{ toast.onConfirm.label }}
				</button>
			</div>

			<div
				v-if="toast.type === 'notification' && toast.lifetimeMs"
				class="progress-bar"
				:style="{ '--lifetime': `${toast.lifetimeMs}ms` }"
			></div>
		</div>
	</div>
</template>

<script setup lang="ts">
import { useToast, type Toast } from '@/composables/useToast'
import { useElementHover } from '@vueuse/core'
import { Info, Mail, SquareCheck, TriangleAlert } from 'lucide-vue-next'
import { onMounted, ref, watch } from 'vue'

const props = defineProps<{
	toast: Toast
	index: number
}>()

const elementRef = ref<HTMLElement>()
const isHovered = useElementHover(elementRef)
const { removeToast } = useToast()

const remainingTime = ref(props.toast.lifetimeMs || 0)
let timerId: ReturnType<typeof setTimeout> | undefined
let lastStartTime = 0

function startTimer() {
	if (remainingTime.value <= 0) return

	lastStartTime = Date.now()
	timerId = setTimeout(() => {
		handleExpiration()
	}, remainingTime.value)
}

function pauseTimer() {
	if (timerId) {
		clearTimeout(timerId)
		timerId = undefined
		const elapsed = Date.now() - lastStartTime
		remainingTime.value = Math.max(0, remainingTime.value - elapsed)
	}
}

function handleExpiration() {
	if (props.toast.type === 'notification') {
		removeToast(props.toast.id)
	} else if (
		props.toast.type === 'acknowledgement_request' ||
		props.toast.type === 'action_request'
	) {
		props.toast.onConfirm.func(props.toast)
	}
}

watch(isHovered, (hovered) => {
	if (props.toast.lifetimeMs) {
		if (hovered) {
			pauseTimer()
		} else {
			startTimer()
		}
	}
})

onMounted(() => {
	if (props.toast.lifetimeMs) {
		startTimer()
	}
})

function handleConfirm() {
	if (props.toast.type === 'action_request' || props.toast.type === 'acknowledgement_request') {
		props.toast.onConfirm.func(props.toast)
	}
}

function handleDeny() {
	if (props.toast.type === 'action_request') {
		props.toast.onDeny.func(props.toast)
	}
}
</script>

<style scoped>
.toast-container {
	grid-area: stack;
	width: min(calc(100vw - 2 * (1.8rem)), 26rem);
	margin: 0 2rem;
	transition: transform 0.2s;
	pointer-events: none;
}

.toast-content {
	pointer-events: auto;
	--_color: #0077ff;
	background: color-mix(in lch, var(--bg-color), #fff 10%);
	color: var(--text-color-primary);
	padding: 1.2rem 1.8rem;
	overflow: hidden;
	box-shadow:
		inset calc(70px) 0px 140px -80px var(--_color),
		inset 2px 0px 0px -1px var(--_color),
		0px 0px 1rem -0.3rem var(--bg-color);
	border-radius: 0.7rem;

	display: grid;
	grid-template-rows: auto auto auto;
	grid-template-columns: 1fr auto;

	column-gap: 0.6rem;

	grid-template-areas: 'title infoicon' 'message infoicon' 'actions actions';
	animation: slide-in 0.4s ease-in-out;
}

.toast-content:hover .progress-bar,
.toast-content:hover .btn-confirm {
	animation-play-state: paused !important;
}

@keyframes slide-in {
	from {
		transform: translateX(-20px);
		opacity: 0;
	}

	to {
		transform: translateX(0);
		opacity: 1;
	}
}

.priority-low {
	box-shadow:
		inset calc(70px) 0px 140px -80px var(--_color),
		0px 0px 1rem -0.3rem var(--bg-color);
}

.title {
	margin-bottom: 0.4rem;
	line-height: 100%;
	grid-area: title;
}

.message {
	grid-area: message;
	white-space: pre-wrap;
	overflow-wrap: break-word;
	word-break: break-all;
	min-width: 0;
}

.icon {
	grid-area: infoicon;
	display: flex;
	align-items: center;
	justify-content: center;
	color: var(--_color);
}

.svg-icon {
	height: 2rem;
	width: 2rem;
}

.priority-medium {
	--_color: #f63bed;
}

.priority-high {
	--_color: #ffbb00;
	border: 1px solid var(--_color);
}

.toast-actions {
	grid-area: actions;
	display: flex;
	gap: 1rem;
	margin-top: 1rem;
	justify-content: flex-end;
	position: relative;
	right: -0.6rem;
	flex-wrap: wrap-reverse;
}

button {
	border: none;
	border-radius: 4px;
	padding: 6px 12px;
	font-size: 12px;
	cursor: pointer;
	font-weight: 500;
	transition:
		background 0.2s,
		color 0.2s;
	background: color-mix(in lch, var(--_color), transparent 60%);
	color: var(--text-color-primary);
	height: 2.8rem;
	box-shadow: inset 0px 0px 0px 1px color-mix(in lch, var(--_color), transparent 70%);
}

button:hover {
	background: color-mix(in lch, var(--_color), transparent 20%);
}

.btn-confirm {
	background-size: 200% 100%;
	background-image: linear-gradient(
		to right,
		color-mix(in lch, var(--_color), transparent 20%) 50%,
		color-mix(in lch, var(--_color), transparent 60%) 50%
	);
	background-position: 100% 0;
}

.btn-confirm[style*='--lifetime'] {
	animation: progress-bg var(--lifetime) linear forwards;
}

.btn-confirm:hover {
	background-position: 0% 0 !important;
	transition: background-position 0.2s ease-out;
}

@keyframes progress-bg {
	to {
		background-position: 0% 0;
	}
}

.btn-deny {
	--_color: rgb(94, 94, 94);
	color: var(--text-color-secondary);
	background: transparent;
	box-shadow: inset 0px 0px 0px 1px var(--_color);
}

.btn-deny:hover {
	background: color-mix(in lch, var(--_color), transparent 20%);
	color: var(--text-color-primary);
}

.btn-close {
	position: absolute;
	top: 8px;
	right: 8px;
	background: transparent;
	color: #666;
	padding: 4px;
	line-height: 1;
	font-size: 16px;
}

.btn-close:hover {
	color: white;
}

/* Progress Bar */
.progress-bar {
	position: absolute;
	bottom: 0;
	left: 0;
	height: 3px;
	background: rgba(255, 255, 255, 0.3);
	width: 100%;
	transform-origin: left;
	animation: progress var(--lifetime) linear forwards;
}

@keyframes progress {
	from {
		transform: scaleX(1);
	}

	to {
		transform: scaleX(0);
	}
}
</style>
