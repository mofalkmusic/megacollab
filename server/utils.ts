import chalk from 'chalk'
import { formatHex } from 'culori'
import { Hono } from 'hono'

import { join } from 'node:path'
import { mkdir } from 'node:fs/promises'
import { DEV_FILE_SERVE_URL } from './constants'

export function randomSafeHexColor(): string {
	const h = Math.random() * 360
	const s = 0.6 + Math.random() * 0.4
	const l = 0.5 + Math.random() * 0.3
	return formatHex({ mode: 'hsl', h, s, l })
}

export const print = {
	store: (...msg: unknown[]) =>
		console.log(`${chalk.magenta.bold('[STORE]')} ${String(msg.join(' '))}`),
	db: (...msg: unknown[]) => console.log(`${chalk.green.bold('[DB]')} ${String(msg.join(' '))}`),
	server: (...msg: unknown[]) =>
		console.log(`${chalk.yellow.bold('[SERVER]')} ${String(msg.join(' '))}`),
	history: (...msg: unknown[]) =>
		console.log(`${chalk.grey.bold('[HISTORY]')} ${String(msg.join(' '))}`),
} as const

type DevFileHandlerOptions = {
	app: Hono
	devFilesDir: string
}

export async function setupDevelopmentFileHandlerRoutes({
	app,
	devFilesDir,
}: DevFileHandlerOptions) {
	await mkdir(devFilesDir, { recursive: true })

	app.put('/api/dev-upload', async (c) => {
		try {
			const url = new URL(c.req.url)
			const key = url.searchParams.get('key')

			if (!key) {
				return c.text('Missing key parameter', 400)
			}

			const safeKey = key.replace(/[^a-zA-Z0-9._\-\/]/g, '_').replace(/\.\./g, '')

			const filePath = join(devFilesDir, safeKey)

			// Get the file content from the request body
			const arrayBuffer = await c.req.arrayBuffer()

			// Write the file to disk - Bun.write automatically creates parent directories
			await Bun.write(filePath, arrayBuffer)

			return c.text('File uploaded successfully', 200)
		} catch (err) {
			print.server('File upload error:', err)
			return c.text('Upload failed', 500)
		}
	})

	app.get(`${DEV_FILE_SERVE_URL}*`, async (c) => {
		try {
			const path = c.req.path.replace(DEV_FILE_SERVE_URL, '')

			if (!path) {
				return c.text('File not found', 404)
			}

			// Security: Basic sanitization
			const safePath = path.replace(/\.\./g, '').replace(/^\//, '')

			const filePath = join(devFilesDir, safePath)
			const file = Bun.file(filePath)

			if (!(await file.exists())) {
				return c.text('File not found', 404)
			}

			// Determine content type from file extension
			const ext = safePath.split('.').pop()?.toLowerCase()
			let contentType = 'application/octet-stream'
			if (ext === 'mp3') contentType = 'audio/mpeg'
			else if (ext === 'wav') contentType = 'audio/wav'

			return new Response(file, {
				headers: {
					'Content-Type': contentType,
					'Cache-Control': 'public, max-age=3600',
				},
			})
		} catch (err) {
			print.server('File serving error:', err)
			return c.text('Internal server error', 500)
		}
	})
}

import { uniqueNamesGenerator, adjectives, colors, animals } from 'unique-names-generator'

export function getRandomName(seed?: string) {
	return uniqueNamesGenerator({
		dictionaries: [adjectives, colors, animals],
		separator: '_',
		length: 3,
		style: 'lowerCase',
		seed,
	})
}
