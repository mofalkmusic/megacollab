export function sanitizeLetterUnderscoreOnly(name: string, allowDot: boolean = true): string {
	const pattern = allowDot ? /[^a-zA-Z0-9._]/g : /[^a-zA-Z0-9_]/g
	return name.replace(pattern, '_')
}

/**
 * calls santize on file_name just incase :D
 *
 *
 * in most places double sanitization but worth it for consistency
 */
export function makeAudioFileHash(opts: {
	creator_user_id: string
	file_name: string
	duration: number
}) {
	return btoa(
		`${opts.creator_user_id}:${sanitizeLetterUnderscoreOnly(opts.file_name)}:${opts.duration}`,
	)
}
