import { shallowRef } from 'vue'

/**
 * When `true`, global keyboard handlers should early-return
 * so menu-specific shortcuts take priority.
 */
export const menuShortcutsActive = shallowRef(false)
