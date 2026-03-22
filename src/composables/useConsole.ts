import { ref } from 'vue'
import { nanoid } from 'nanoid'
import type { User } from '~/schema'

const MAX_MESSAGES = 69 as const

const ConsoleColorPalette = {
	red: 'hsl(0, 80%, 65%)',
	green: 'hsl(120, 60%, 60%)',
	blue: 'hsl(210, 80%, 65%)',
	cyan: 'hsl(180, 80%, 60%)',
	yellow: 'hsl(50, 90%, 60%)',
	orange: 'hsl(30, 90%, 60%)',
	purple: 'hsl(270, 70%, 65%)',
	white: 'hsl(0, 0%, 95%)',
	gray: 'hsl(0, 0%, 60%)',
} as const

export type ConsoleColor = keyof typeof ConsoleColorPalette

export type ConsoleMessageLink = {
	label: string
	action: () => void
}

export type ConsoleMessageOptions = {
	textColor?: ConsoleColor | string
	backgroundColor?: ConsoleColor | string
	isBold?: boolean
	links?: ConsoleMessageLink[]
	reply_to_id?: string | null
	display_name?: string
}

export type ConsoleMessageOptionsUser = ConsoleMessageOptions & {
	display_name: User['display_name']
	user_id: User['id']
}

export type ConsoleSender = 'SYSTEM' | 'USER' | 'UNDO' | 'UPLOAD' | 'DOWNLOAD' | 'CHAT'

export type ConsoleMessage = {
	id: string
	sender: ConsoleSender
	text: string
	timestamp: number
	options?: ConsoleMessageOptions
}

const messages = ref<ConsoleMessage[]>([])

export function useConsole() {
	function userLog(
		sender: 'USER' | 'CHAT',
		text: string,
		options: ConsoleMessageOptionsUser,
	): void
	function userLog(
		sender: Exclude<ConsoleSender, 'USER' | 'CHAT'>,
		text: string,
		options?: ConsoleMessageOptions,
	): void
	function userLog(sender: ConsoleSender, text: string, options: ConsoleMessageOptions = {}) {
		const message: ConsoleMessage = {
			id: nanoid(),
			sender,
			text,
			timestamp: Date.now(),
			options,
		}

		messages.value.push(message)

		if (messages.value.length > MAX_MESSAGES) {
			messages.value.shift()
		}
	}

	function clear() {
		messages.value = []
	}

	return {
		messages,
		userLog,
		clear,
	}
}
