import { Pool } from 'pg'
import { PGlite } from '@electric-sql/pglite'
import { join } from 'node:path'
import {
	type AudioFileBase,
	type ClientTrack,
	type Clip,
	type ServerTrack,
	type UpdateClip,
	type User,
} from '~/schema'
import { migrations } from './migrations'
import { print, randomSafeHexColor } from './utils'
import { nanoid } from 'nanoid'
import { DEV_DATABASE_FOLDER } from './constants'
import z from 'zod'

const SessionSchema = z.object({
	session_id: z.string(),
	user_id: z.string(),
	created_at: z.iso.datetime({ offset: true }),
})

export type Session = z.output<typeof SessionSchema>

const IN_DEV_MODE = Bun.env['ENV'] === 'development'
export type QueryHandler = <T = any>(query: string, params?: any[]) => Promise<T[]>

let queryFn: QueryHandler

const databaseUrl = Bun.env['DATABASE_URL']

if (!IN_DEV_MODE) {
	if (!databaseUrl) {
		print.db('No database URL provided.')
		throw new Error('No database URL provided.')
	}

	print.db('Using Postgres')

	const pool = new Pool({
		connectionString: databaseUrl,
		ssl: { rejectUnauthorized: false },
	})

	queryFn = async (query, params = []) => {
		const res = await pool.query(query, params)
		return res.rows as any
	}
} else {
	print.db('Using PGlite')

	const dataDir = join(import.meta.dir, '..', DEV_DATABASE_FOLDER)
	const client = new PGlite(dataDir)

	queryFn = async (query, params = []) => {
		const res = await client.query(query, params)
		return res.rows as any
	}
}

export const USERS_TABLE = 'megacollab_users' as const
export const AUDIOFILES_TABLE = 'megacollab_audiofiles' as const
export const TRACKS_TABLE = 'megacollab_tracks' as const
export const CLIPS_TABLE = 'megacollab_clips' as const
export const MIGRATIONS_TABLE = 'megacollab_migrations' as const
export const SESSIONS_TABLE = 'megacollab_sessions' as const

export const db = {
	query: queryFn,
	saveAudioFile,
	migrateAndSeedDb,
	getAudioFilesSafe,
	createTrackSafe,
	getTracksSafe,
	createClipSafe,
	getClipsSafe,
	getClipSafe,
	deleteClipSafe,
	updateClipSafe,
	updateExistingUsernameSafe,
	makeNewIfNotExistUserSafe,
	saveSessionSafe,
	getUserFromSessionIdSafe,
	getOrCreateDevUser,
	deleteAudioFileSafe,
}

const audioFileCache = new Map<string, AudioFileBase>()

async function getAudioFilesSafe(): Promise<AudioFileBase[]> {
	try {
		return await queryFn<AudioFileBase>(`SELECT * FROM ${AUDIOFILES_TABLE}`)
	} catch (err) {
		if (IN_DEV_MODE) print.db('error:', err)
		return [] // todo: may want to actually provide an error to the client...
	}
}

async function createTrackSafe(
	track: Omit<ServerTrack, 'order_index'>,
): Promise<ClientTrack | null> {
	try {
		const { id, creator_user_id, title, belongs_to_user_id, gain_db } = track

		const rows = await queryFn<ClientTrack>(
			`
			WITH inserted AS (
				INSERT INTO ${TRACKS_TABLE} (id, creator_user_id, title, belongs_to_user_id, gain_db, order_index) 
				VALUES ($1, $2, $3, $4, $5, (SELECT COALESCE(MAX(order_index), 0) + 1 FROM ${TRACKS_TABLE}))
				RETURNING *
			)
			SELECT 
				inserted.*,
				users.display_name AS belongs_to_display_name
			FROM inserted
			LEFT JOIN ${USERS_TABLE} AS users
				ON inserted.belongs_to_user_id = users.id
		`,
			[id, creator_user_id, title, belongs_to_user_id, gain_db],
		)

		if (!rows.length) return null
		const result = rows[0]!

		return result
	} catch (err) {
		if (IN_DEV_MODE) print.db('error:', err)
		return null
	}
}

async function getTracksSafe(): Promise<ClientTrack[]> {
	try {
		return await queryFn<ClientTrack>(`
			SELECT
				t.*,
				u.display_name AS belongs_to_display_name
			FROM ${TRACKS_TABLE} AS t
			LEFT JOIN ${USERS_TABLE} AS u ON t.belongs_to_user_id = u.id
		`)
	} catch (err) {
		if (IN_DEV_MODE) print.db('error:', err)
		return [] // todo: may want to actually provide an error to the client...
	}
}

async function createClipSafe(clip: Omit<Clip, 'created_at'>): Promise<Clip | null> {
	try {
		const {
			id,
			creator_user_id,
			track_id,
			audio_file_id,
			end_beat,
			start_beat,
			gain_db,
			offset_seconds,
		} = clip

		const rows = await queryFn<Clip>(
			`
			INSERT INTO ${CLIPS_TABLE} (id, creator_user_id, track_id, audio_file_id, end_beat, start_beat, gain_db, offset_seconds) 
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
			RETURNING *
		`,
			[id, creator_user_id, track_id, audio_file_id, end_beat, start_beat, gain_db, offset_seconds],
		)

		if (!rows.length) return null
		const result = rows[0]!

		return result
	} catch (err) {
		if (IN_DEV_MODE) print.db('error:', err)
		return null
	}
}

async function getClipsSafe(): Promise<Clip[]> {
	try {
		return await queryFn<Clip>(`SELECT * FROM ${CLIPS_TABLE}`)
	} catch (err) {
		if (IN_DEV_MODE) print.db('error:', err)
		return [] // todo: may want to actually provide an error to the client...
	}
}

async function getClipSafe(id: string): Promise<Clip | null> {
	try {
		const rows = await queryFn<Clip>(`SELECT * FROM ${CLIPS_TABLE} WHERE id = $1`, [id])
		return rows[0] || null
	} catch (err) {
		if (IN_DEV_MODE) print.db('error:', err)
		return null
	}
}

async function updateClipSafe(id: string, changes: UpdateClip): Promise<Clip | null> {
	try {
		const entries = Object.entries(changes)

		const setClauses = entries.map(([key], index) => `${key} = $${index + 2}`)

		const values = entries.map(([, value]) => value)

		const sql = `
			UPDATE ${CLIPS_TABLE}
			SET ${setClauses.join(', ')}
			WHERE id = $1
			RETURNING *
		`

		const rows = await queryFn<Clip>(sql, [id, ...values])

		if (!rows.length) return null
		const result = rows[0]!

		return result
	} catch (err) {
		if (IN_DEV_MODE) print.db('error:', err)
		return null
	}
}

async function deleteClipSafe(id: string): Promise<Clip | null> {
	try {
		const rows = await queryFn<Clip>(
			`
			DELETE FROM ${CLIPS_TABLE} WHERE id = $1
			RETURNING *
		`,
			[id],
		)

		if (!rows.length) return null
		const result = rows[0]!

		return result
	} catch (err) {
		if (IN_DEV_MODE) print.db('error:', err)
		return null
	}
}

async function saveAudioFile(audioFile: AudioFileBase): Promise<AudioFileBase | null> {
	try {
		const { id, creator_user_id, file_name, public_url, duration, created_at, color } = audioFile

		const rows = await queryFn<AudioFileBase>(
			`
			INSERT INTO ${AUDIOFILES_TABLE} (id, creator_user_id, file_name, public_url, duration, created_at, color) 
			VALUES ($1, $2, $3, $4, $5, $6, $7)
			RETURNING *
		`,
			[id, creator_user_id, file_name, public_url, duration, created_at, color],
		)

		if (!rows.length) return null

		const result = rows[0]!
		audioFileCache.set(result.id, result)
		return result
	} catch (err) {
		if (IN_DEV_MODE) print.db('error:', err)
		return null
	}
}

async function makeNewIfNotExistUserSafe(user: Omit<User, 'created_at'>): Promise<User | null> {
	try {
		const { id, display_name, provider, provider_id, provider_email, roles, color } = user

		const rows = await queryFn<User>(
			`
			INSERT INTO ${USERS_TABLE} (id, display_name, provider, provider_id, provider_email, roles, color) 
			VALUES ($1, $2, $3, $4, $5, $6, $7)
			ON CONFLICT (provider, provider_id) DO UPDATE
				SET
					provider_email=EXCLUDED.provider_email
			RETURNING *
		`,
			[id, display_name, provider, provider_id, provider_email, roles, color],
		)

		if (!rows.length) return null

		const result = rows[0]!
		return result
	} catch (err) {
		if (IN_DEV_MODE) print.db('error:', err)
		return null
	}
}

async function saveSessionSafe(session: Omit<Session, 'created_at'>): Promise<Session | null> {
	try {
		const { session_id, user_id } = session

		const rows = await queryFn<Session>(
			`
			INSERT INTO ${SESSIONS_TABLE} (session_id, user_id) 
			VALUES ($1, $2)
			RETURNING *
		`,
			[session_id, user_id],
		)

		if (!rows.length) return null

		const result = rows[0]!
		return result
	} catch (err) {
		if (IN_DEV_MODE) print.db('error:', err)
		return null
	}
}

async function getUserFromSessionIdSafe(session_id: string): Promise<User | null> {
	try {
		const rows = await queryFn<User>(
			`
			SELECT u.* 
			FROM ${SESSIONS_TABLE} AS s
			JOIN ${USERS_TABLE} AS u ON s.user_id = u.id
			WHERE s.session_id = $1 AND s.created_at > NOW() - INTERVAL '7 days'
		`,
			[session_id],
		)

		if (!rows.length) return null

		const result = rows[0]!
		return result
	} catch (err) {
		if (IN_DEV_MODE) print.db('error:', err)
		return null
	}
}

async function updateExistingUsernameSafe(
	id: string,
	username: string,
): Promise<User['display_name'] | null> {
	try {
		const rows = await queryFn<Pick<User, 'display_name'>>(
			`
			UPDATE ${USERS_TABLE}
			SET display_name = $2
			WHERE id = $1
			RETURNING display_name
		`,
			[id, username],
		)

		if (!rows.length) return null
		const result = rows[0]!

		return result.display_name
	} catch (err) {
		if (IN_DEV_MODE) print.db('error:', err)
		return null
	}
}

// async function getFullClientByUser(user: User): Promise<(Client & User) | null> {
// 	const { id, email, display_name } = user

// 	try {
// 		const rows = await queryFn<Client & User>(
// 			`
// 			INSERT INTO ${USERS_TABLE} (id, email, display_name, color, roles)
// 			VALUES ($1, $2, $3, $4, $5)
// 			ON CONFLICT (id) DO UPDATE SET email=EXCLUDED.email
// 			RETURNING *
// 		`,
// 			[id, email, display_name, randomSafeHexColor(), DEFAULT_ROLES],
// 		)

// 		if (!rows.length) return null
// 		const result = rows[0]!

// 		return result
// 	} catch (err) {
// 		if (IN_DEV_MODE) print.db('error:', err)
// 		return null
// 	}
// }

async function migrateAndSeedDb() {
	await queryFn(`
		CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
			id INTEGER PRIMARY KEY,
			name TEXT NOT NULL,
			applied_at TIMESTAMPTZ DEFAULT NOW()
		)`)

	const applied = await queryFn<{ id: number; name: string }>(
		`SELECT id, name FROM ${MIGRATIONS_TABLE}`,
	)
	const appliedIds = new Set(applied.map((m) => m.id))

	let count = 0

	for (const migration of migrations) {
		if (appliedIds.has(migration.id)) continue

		try {
			await migration.func(queryFn)

			await queryFn(`INSERT INTO ${MIGRATIONS_TABLE} (id, name) VALUES ($1, $2)`, [
				migration.id,
				migration.name,
			])

			count++
		} catch (err) {
			print.db(`Migration ${migration.id} failed: ${err}`)
			throw err
		}
	}

	if (count > 0) print.db(`Applied ${count} new migration${count > 1 ? 's' : ''}.`)
}

async function getOrCreateDevUser(): Promise<User | null> {
	if (!IN_DEV_MODE) return null

	try {
		// Try to find the dev user first
		const rows = await queryFn<User>(
			`SELECT * FROM ${USERS_TABLE} WHERE provider_id = $1 AND provider = $2`,
			['dev-user-id', 'dev'],
		)

		if (rows.length > 0) {
			return rows[0]!
		}

		// Create if not exists
		const newUser: Omit<User, 'created_at'> = {
			id: nanoid(),
			display_name: 'Dev User',
			provider: 'dev',
			provider_id: 'dev-user-id',
			provider_email: 'dev@local.host',
			roles: ['admin', 'regular'],
			color: randomSafeHexColor(),
		}

		return await makeNewIfNotExistUserSafe(newUser)
	} catch (err) {
		print.db('error creating dev user:', err)
		return null
	}
}

async function deleteAudioFileSafe(
	id: string,
): Promise<{ deleted_clips: Clip['id'][]; deleted_file: AudioFileBase } | null> {
	try {
		const rows = await queryFn<AudioFileBase & { deleted_clip_ids: Clip['id'][] | null }>(
			`
			WITH deleted_clips AS (
				DELETE FROM ${CLIPS_TABLE}
				WHERE audio_file_id = $1
				RETURNING id
			)
			DELETE FROM ${AUDIOFILES_TABLE}
			WHERE id = $1
			RETURNING *, (SELECT array_agg(id) FROM deleted_clips) AS deleted_clip_ids
			`,
			[id],
		)

		if (!rows.length) return null
		const row = rows[0]!

		const { deleted_clip_ids, ...fileData } = row

		return {
			deleted_clips: deleted_clip_ids || [],
			deleted_file: fileData,
		}
	} catch (err) {
		if (IN_DEV_MODE) print.db('error:', err)
		return null
	}
}
