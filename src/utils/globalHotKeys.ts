import { useEventListener, useWindowFocus } from '@vueuse/core'
import { menuShortcutsActive } from '@/composables/useMenuShortcutLock'
import { shallowRef, watch } from 'vue'

export const altKeyPressed = shallowRef(false)
export const controlKeyPressed = shallowRef(false)
export const shiftKeyPressed = shallowRef(false)
export const zKeyPressed = shallowRef(false)
export const tKeyPressed = shallowRef(false)
export const lKeyPressed = shallowRef(false)

const windowFocused = useWindowFocus()

watch(windowFocused, (focused) => {
	if (!focused) {
		altKeyPressed.value = false
		controlKeyPressed.value = false
		shiftKeyPressed.value = false
		zKeyPressed.value = false
		tKeyPressed.value = false
		lKeyPressed.value = false
	}
})

useEventListener(window, 'keydown', (event: KeyboardEvent) => {
	const target = event.target

	if (event.key === 'Alt') {
		altKeyPressed.value = true
	}

	if (event.key === 'Control') {
		controlKeyPressed.value = true
	}

	if (event.key === 'Shift') {
		shiftKeyPressed.value = true
	}

	if (
		target instanceof HTMLElement &&
		(target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
	) {
		return
	}

	if (menuShortcutsActive.value) return

	if (event.key === 'Alt') {
		event.preventDefault()
		return
	}

	if (event.key === 'Control') {
		return
	}

	if (event.key === 'Shift') {
		return
	}

	if (event.key === 'z') {
		zKeyPressed.value = true
		return
	}

	if (event.key === 't') {
		tKeyPressed.value = true
		return
	}

	if (event.key === 'l') {
		lKeyPressed.value = true
		return
	}
})

useEventListener(window, 'keyup', (event: KeyboardEvent) => {
	if (event.key === 'Alt') {
		altKeyPressed.value = false
		event.preventDefault()
		return
	}

	if (event.key === 'Control') {
		controlKeyPressed.value = false
		return
	}

	if (event.key === 'Shift') {
		shiftKeyPressed.value = false
		return
	}

	if (event.key === 'z') {
		zKeyPressed.value = false
		return
	}

	if (event.key === 't') {
		tKeyPressed.value = false
		return
	}

	if (event.key === 'l') {
		lKeyPressed.value = false
		return
	}
})
