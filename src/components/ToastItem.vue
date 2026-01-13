<template>
	<div ref="elementRef" v-bind="$attrs" class="toast-container">
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
	width: min(calc(100vw - 4rem), 24rem);
	transition: all 0.2s;
	pointer-events: none;
}

.toast-content {
	position: relative;
	pointer-events: auto;
	--_color: #0077ff;
	background: color-mix(in lch, var(--bg-color), white 5%);
	color: var(--text-color-primary);
	padding: 1rem 1.2rem;
	overflow: hidden;
	border: 1px solid var(--border-primary);
	border-left: 4px solid var(--_color);
	border-radius: 0.5rem;
	box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);

	display: grid;
	grid-template-rows: auto auto auto;
	grid-template-columns: 1fr auto;

	column-gap: 0.8rem;

	grid-template-areas: 'title infoicon' 'message infoicon' 'actions actions';
	animation: slide-in 0.3s ease-out;
}

.toast-content:hover .progress-bar,
.toast-content:hover .btn-confirm {
	animation-play-state: paused !important;
}

@keyframes slide-in {
	from {
		transform: translateX(20px);
		opacity: 0;
	}

	to {
		transform: translateX(0);
		opacity: 1;
	}
}

.priority-low {
	--_color: #0077ff;
}

.priority-medium {
	--_color: #f63bed;
}

.priority-high {
	--_color: #ffbb00;
}

.title {
	margin-bottom: 0.2rem;
	line-height: 1.2;
	font-weight: 600;
	grid-area: title;
}

.message {
	grid-area: message;
	white-space: pre-wrap;
	overflow-wrap: break-word;
	word-break: break-all;
	min-width: 0;
	line-height: 1.4;
	color: var(--text-color-secondary);
}

.icon {
	grid-area: infoicon;
	display: flex;
	align-items: center;
	justify-content: center;
	color: var(--_color);
}

.svg-icon {
	height: 1.5rem;
	width: 1.5rem;
}

.toast-actions {
	grid-area: actions;
	display: flex;
	gap: 0.5rem;
	margin-top: 0.8rem;
	justify-content: flex-end;
	flex-wrap: wrap-reverse;
}

button {
	border: none;
	border-radius: 0.25rem;
	padding: 0.4rem 0.8rem;
	font-size: 0.85rem;
	cursor: pointer;
	font-weight: 500;
	transition: background 0.2s;
	background: color-mix(in lch, var(--bg-color), white 10%);
	border: 1px solid var(--border-primary);
	color: var(--text-color-primary);
}

button:hover {
	background: color-mix(in lch, var(--bg-color), white 20%);
}

.btn-confirm {
	background: var(--_color);
	color: black; /* contrast against bright priority colors */
	border: none;
	font-weight: 600;
}

.btn-confirm:hover {
	filter: brightness(1.1);
}

.btn-confirm[style*='--lifetime'] {
	/* Removing the complex background animation for button to simplify */
	/* If we want progress on button, we can keep it, but user wanted simple */
	/* leaving it out for cleaner look, or maybe just kept on progress bar */
}

/* Progress Bar */
.progress-bar {
	position: absolute;
	bottom: 0;
	left: 0;
	height: 3px;
	background: var(--_color);
	opacity: 0.5;
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
