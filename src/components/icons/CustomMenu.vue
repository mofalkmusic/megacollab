<template>
	<div class="hamburgerWrap">
		<div class="hamburgerMenu">
			<div :class="['hamburgerLine', props.isMenuOpen ? 'makeX' : '']"></div>
			<div :class="['hamburgerLine', props.isMenuOpen ? 'makeX' : '']"></div>
			<div :class="['hamburgerLine', props.isMenuOpen ? 'makeX' : '']"></div>
		</div>
	</div>
</template>

<script setup lang="ts">
const props = defineProps<{
	isMenuOpen: boolean
}>()
</script>

<style scoped>
.hamburgerWrap {
	display: flex;
	justify-content: center;
	align-items: center;
	height: 100%;
	width: 100%;
}

.hamburgerMenu {
	display: flex;
	flex-direction: column;
	--_gapHam: 4px;
	--_lineHeight: 2px;
	--_lineW: 21px;
	gap: var(--_gapHam);
	cursor: pointer;
	position: relative;
	background-color: transparent;
	border: none;
	padding: 0;
}

.hamburgerMenu::before {
	content: '';
	position: absolute;
	--_size: -1.5rem;

	inset: var(--_size);
}

.hamburgerLine {
	background-color: var(--text-color-primary);
	width: var(--_lineW);
	height: var(--_lineHeight);
	transition: all 250ms ease-in-out;
}

.hamburgerLine:first-child.makeX {
	transform: translateY(calc(var(--_gapHam) + var(--_lineHeight))) rotate(45deg);
	transform-origin: center center;
}

.hamburgerLine:last-child.makeX {
	transform: translateY(calc((var(--_gapHam) * -1) - var(--_lineHeight))) rotate(-45deg);
	transform-origin: center center;
}

.hamburgerLine:nth-child(2).makeX {
	width: 0px;
}
</style>
