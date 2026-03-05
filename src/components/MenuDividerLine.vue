<template>
	<div :style="style"></div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(
	defineProps<{
		/**
		 * in rem
		 */
		distance?: number
	}>(),
	{
		distance: 0.3,
	},
)

const style = computed(() => ({
	borderTop: `1px solid var(--border-primary)`,
	marginTop: `${props.distance}rem`,
	paddingBottom: `${props.distance}rem`,
}))
</script>
