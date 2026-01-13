import { computed, ref } from 'vue'
import { useTimeoutPoll, tryOnUnmounted, type Pausable, tryOnMounted } from '@vueuse/core'
import { socket } from '@/socket/socket'

const inDev = import.meta.env.MODE === 'development'

export function usePing() {
	let pollControl: Pausable | null = null

	const _poll_interval = 2000
	const _arr_max_length = 10

	const initialPingVals = [20, 40, 80, 10, 20, 40]

	const pingVals = ref<number[]>(initialPingVals)

	const averagePing = computed(() => {
		const total = pingVals.value.reduce((prev, curr) => prev + curr, 0)
		return Math.round(total / pingVals.value.length / 2)
	})

	function startPing() {
		if (pollControl) return

		pollControl = useTimeoutPoll(async () => {
			if (socket.readyState.value !== 'READY') return

			const t0 = performance.now()

			const { success, error } = await socket.emitWithAck('get:ping', null)

			const t1 = performance.now()

			let roundTripTime = Math.round(t1 - t0)

			if (!success) {
				console.warn(error)
				roundTripTime = 999
			}

			if (inDev) {
				pingVals.value.push(Math.round(Math.random() * 100))
			} else {
				pingVals.value.push(roundTripTime)
			}

			if (pingVals.value.length > _arr_max_length) {
				pingVals.value = pingVals.value.slice(1)
			}
		}, _poll_interval)
	}

	function stopPing() {
		if (pollControl) {
			pollControl.pause()
			pollControl = null
		}
	}

	tryOnMounted(() => startPing())
	tryOnUnmounted(() => stopPing())

	return {
		pingVals,
		averagePing,
		startPing,
		stopPing,
	}
}
