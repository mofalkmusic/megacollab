import { computed } from 'vue'
import { pxPerBeat } from '@/state'

const GRID_MIN_SPACING_PX = 15 as const
const BASE_LINE_BRIGHTNESS = 6 as const
const LINE_BRIGHTNESS_MULTIPLIER_UP = 20 as const

export type GridLevel = {
	beats: number
	rank: number
}

export function useTimelineGrid() {
	const ALL_LEVELS = [16, 8, 4, 2, 1, 0.5, 0.25, 0.125, 0.0625] as const

	const activeLevels = computed((): GridLevel[] => {
		const visible = ALL_LEVELS.filter((beats) => beats * pxPerBeat.value >= GRID_MIN_SPACING_PX)

		// index 0 = coarsest visible = highest rank
		return visible.map((beats, i) => ({
			beats,
			rank: visible.length - i,
		}))
	})

	const totalLevels = computed(() => activeLevels.value.length)

	// reusable for all
	const gridBackground = computed(() => {
		const layers = activeLevels.value.map((level) => {
			// rank 1 = dimmest, rank N = brightest
			const brightness =
				BASE_LINE_BRIGHTNESS +
				(level.rank / totalLevels.value) * LINE_BRIGHTNESS_MULTIPLIER_UP
			const color = `color-mix(in srgb, var(--bg-color), var(--text-color-primary) ${brightness}%)`

			return `repeating-linear-gradient(
				90deg,
				${color} 0px 1px,
				transparent 1px,
				transparent ${level.beats * pxPerBeat.value}px
			)`
		})

		// bg shading
		const barPx = 16 * pxPerBeat.value
		layers.push(`repeating-linear-gradient(
			90deg,
			var(--bg-color) 0px,
			var(--bg-color) ${barPx}px,
			color-mix(in srgb, var(--bg-color), var(--text-color-primary) 2%) ${barPx}px,
			color-mix(in srgb, var(--bg-color), var(--text-color-primary) 2%) ${barPx * 2}px
		)`)

		return layers.join(', ')
	})

	return {
		activeLevels,
		totalLevels,
		gridBackground,
		GRID_MIN_SPACING_PX,
	}
}
