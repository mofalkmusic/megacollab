import { Pool } from 'pg'
import { PGlite } from '@electric-sql/pglite'
import { join } from 'node:path'
import {
	type ClientAudioFile,
	type TrackClient,
	type ClipClient,
	type ServerAudioFile,
	type ClipServer,
	type TrackServer,
	type ClipUpdate,
	type TrackUpdate,
	type User,
} from '~/schema'
import { MAX_TRACKS } from '~/constants'
import { migrations } from './migrations'
import { print, randomSafeHexColor } from './utils'
import { nanoid } from 'nanoid'
import { DEV_DATABASE_FOLDER } from './constants'
import z from 'zod'

export class TrackLimitError extends Error {
	constructor(max: number) {
		super(`Track limit reached (max ${max})`)
		this.name = 'TrackLimitError'
	}
}

export class NotFoundError extends Error {
	constructor(entity: string, id: string) {
		super(`${entity} with id ${id} not found`)
		this.name = 'NotFoundError'
	}
}

export class DatabaseError extends Error {
	constructor(
		message: string,
		public originalError?: unknown,
	) {
		super(message)
		this.name = 'DatabaseError'
	}
}

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
	getAudioFiles,
	getAudioFile,
	createTrack,
	getTracks,
	getTrack,
	updateTrack,
	createClips,
	getClips,
	getClipsByIds,
	getClip,
	deleteClip,
	deleteClips,
	updateClips,
	updateExistingUsername,
	updateDownloadQuality,
	makeNewIfNotExistUser,
	saveSession,
	getUserFromSessionId,
	getOrCreateDevUser,
	deleteAudioFile,
	deleteSession,
	deleteTrack,
	banUser,
	unbanUser,
	getAllUsers,
}

const audioFileCache = new Map<string, ClientAudioFile>()

async function getAudioFiles(): Promise<ClientAudioFile[]> {
	return await queryFn<ClientAudioFile>(`
			SELECT 
				af.*,
				u.display_name AS creator_display_name
			FROM ${AUDIOFILES_TABLE} AS af
			LEFT JOIN ${USERS_TABLE} AS u ON af.creator_user_id = u.id
		`)
}

async function getAudioFile(id: string): Promise<ClientAudioFile | null> {
	const rows = await queryFn<ClientAudioFile>(
		`
			SELECT 
				af.*,
				u.display_name AS creator_display_name
			FROM ${AUDIOFILES_TABLE} AS af
			LEFT JOIN ${USERS_TABLE} AS u ON af.creator_user_id = u.id
			WHERE af.id = $1
		`,
		[id],
	)
	return rows[0] || null
}

async function createTrack(
	track: Omit<TrackServer, 'order_index'>,
	orderIndex?: number,
): Promise<TrackClient> {
	const { id, creator_user_id, title, belongs_to_user_id, gain } = track

	let finalOrderIndex = orderIndex

	if (finalOrderIndex === undefined || finalOrderIndex === null) {
		// no index given -> max +1
		const initialMaxQuery = await queryFn<{ max: number }>(
			`SELECT COALESCE(MAX(order_index), 0) + 1 AS max FROM ${TRACKS_TABLE}`,
		)
		finalOrderIndex = initialMaxQuery[0]?.max ?? 1
	} else {
		// index given -> check if exists
		const initialExistsQuery = await queryFn<{ exists: boolean }>(
			`SELECT EXISTS(SELECT 1 FROM ${TRACKS_TABLE} WHERE order_index = $1) AS exists`,
			[finalOrderIndex],
		)

		if (initialExistsQuery[0]?.exists) {
			// index exists -> get next track
			const getNextIndexQuery = await queryFn<{ order_index: number }>(
				`SELECT order_index FROM ${TRACKS_TABLE} WHERE order_index > $1 ORDER BY order_index ASC LIMIT 1`,
				[finalOrderIndex],
			)

			if (getNextIndexQuery.length > 0 && getNextIndexQuery[0]?.order_index !== undefined) {
				// place it half way
				finalOrderIndex = (finalOrderIndex + getNextIndexQuery[0].order_index) / 2
			} else {
				// no next track -> bump it
				finalOrderIndex = finalOrderIndex + 1
			}
		}
	}

	// regular insert now :D
	const rows = await queryFn<TrackClient>(
		`
			WITH track_count AS (
				SELECT COUNT(*) AS total FROM ${TRACKS_TABLE}
				HAVING COUNT(*) < $6
			),
			inserted AS (
				INSERT INTO ${TRACKS_TABLE} (id, creator_user_id, title, belongs_to_user_id, gain, order_index) 
				SELECT $1, $2, $3, $4, $5, $7
				FROM track_count
				RETURNING *
			)
			SELECT 
				inserted.*,
				users.display_name AS belongs_to_display_name
			FROM inserted
			LEFT JOIN ${USERS_TABLE} AS users
				ON inserted.belongs_to_user_id = users.id
		`,
		[id, creator_user_id, title, belongs_to_user_id, gain, MAX_TRACKS, finalOrderIndex],
	)

	if (!rows.length) throw new TrackLimitError(MAX_TRACKS)
	return rows[0]!
}

async function getTracks(): Promise<TrackClient[]> {
	return await queryFn<TrackClient>(`
			SELECT
				t.*,
				u.display_name AS belongs_to_display_name
			FROM ${TRACKS_TABLE} AS t
			LEFT JOIN ${USERS_TABLE} AS u ON t.belongs_to_user_id = u.id
		`)
}

async function getTrack(id: string): Promise<TrackServer | null> {
	const rows = await queryFn<TrackServer>(`SELECT * FROM ${TRACKS_TABLE} WHERE id = $1`, [id])
	return rows[0] || null
}

async function updateTrack(id: string, changes: TrackUpdate): Promise<TrackClient> {
	const entries = Object.entries(changes)

	if (entries.length === 0) throw new Error('No changes provided')

	const setClauses = entries.map(([key], index) => `${key} = $${index + 2}`)
	const values = entries.map(([, value]) => value)

	const sql = `
			WITH updated AS (
				UPDATE ${TRACKS_TABLE}
				SET ${setClauses.join(', ')}
				WHERE id = $1
				RETURNING *
			)
			SELECT 
				updated.*,
				users.display_name AS belongs_to_display_name
			FROM updated
			LEFT JOIN ${USERS_TABLE} AS users
				ON updated.belongs_to_user_id = users.id
		`

	const rows = await queryFn<TrackClient>(sql, [id, ...values])

	if (!rows.length) throw new NotFoundError('track', id)
	return rows[0]!
}

async function createClips(
	clipsToCreate: Omit<ClipClient, 'created_at' | 'creator_display_name'>[],
): Promise<ClipClient[]> {
	if (clipsToCreate.length === 0) return []

	const placeholders: string[] = []
	const values: any[] = [] // dirty but ok for now...

	for (let i = 0; i < clipsToCreate.length; i++) {
		const clip = clipsToCreate[i]!
		const offset = i * 11

		placeholders.push(
			`($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10}, $${offset + 11})`,
		)

		values.push(
			clip.id,
			clip.creator_user_id,
			clip.track_id,
			clip.audio_file_id,
			clip.end_beat,
			clip.start_beat,
			clip.gain,
			clip.offset_seconds,
			clip.fade_in_sec,
			clip.fade_out_sec,
			clip.is_muted,
		)
	}

	const rows = await queryFn<ClipClient>(
		`
			WITH inserted AS (
				INSERT INTO ${CLIPS_TABLE} (id, creator_user_id, track_id, audio_file_id, end_beat, start_beat, gain, offset_seconds, fade_in_sec, fade_out_sec, is_muted) 
				VALUES ${placeholders.join(', ')}
				RETURNING *
			)
			SELECT 
				inserted.*,
				users.display_name AS creator_display_name
			FROM inserted
			LEFT JOIN ${USERS_TABLE} AS users
				ON inserted.creator_user_id = users.id
		`,
		values,
	)

	return rows
}

async function getClips(): Promise<ClipClient[]> {
	return await queryFn<ClipClient>(`
			SELECT 
				c.*,
				u.display_name AS creator_display_name
			FROM ${CLIPS_TABLE} AS c
			LEFT JOIN ${USERS_TABLE} AS u ON c.creator_user_id = u.id
		`)
}

async function getClip(id: string): Promise<ClipClient | null> {
	const rows = await queryFn<ClipClient>(
		`
			SELECT 
				c.*,
				u.display_name AS creator_display_name
			FROM ${CLIPS_TABLE} AS c
			LEFT JOIN ${USERS_TABLE} AS u ON c.creator_user_id = u.id
			WHERE c.id = $1
		`,
		[id],
	)
	return rows[0] || null
}

async function getClipsByIds(ids: string[]): Promise<ClipClient[]> {
	if (ids.length === 0) return []

	const placeholders = ids.map((_, idx) => `$${idx + 1}`).join(', ')
	const rows = await queryFn<ClipClient>(
		`
		SELECT 
			c.*,
			u.display_name AS creator_display_name
		FROM ${CLIPS_TABLE} AS c
		LEFT JOIN ${USERS_TABLE} AS u ON c.creator_user_id = u.id
		WHERE c.id IN (${placeholders})
	`,
		ids,
	)

	return rows
}

async function updateClips(updates: { id: string; changes: ClipUpdate }[]): Promise<ClipClient[]> {
	if (updates.length === 0) return []

	const results: ClipClient[] = []

	// Since we are running multiple queries, we could ideally use a transaction.
	// We'll execute them sequentially for now to get returning * right with display names.
	for (const { id, changes } of updates) {
		const entries = Object.entries(changes)
		if (entries.length === 0) continue

		const setClauses = entries.map(([key], index) => `${key} = $${index + 2}`)
		const values = entries.map(([, value]) => value)

		const sql = `
				WITH updated AS (
					UPDATE ${CLIPS_TABLE}
					SET ${setClauses.join(', ')}
					WHERE id = $1
					RETURNING *
				)
				SELECT 
					updated.*,
					users.display_name AS creator_display_name
				FROM updated
				LEFT JOIN ${USERS_TABLE} AS users
					ON updated.creator_user_id = users.id
			`

		const rows = await queryFn<ClipClient>(sql, [id, ...values])

		if (!rows.length) throw new NotFoundError('clip', id)
		results.push(rows[0]!)
	}

	return results
}

async function deleteClip(id: string): Promise<ClipClient> {
	const rows = await queryFn<ClipClient>(
		`
			WITH deleted AS (
				DELETE FROM ${CLIPS_TABLE} WHERE id = $1
				RETURNING *
			)
			SELECT 
				deleted.*,
				users.display_name AS creator_display_name
			FROM deleted
			LEFT JOIN ${USERS_TABLE} AS users
				ON deleted.creator_user_id = users.id
		`,
		[id],
	)

	if (!rows.length) throw new NotFoundError('clip', id)
	const result = rows[0]!

	return result
}

async function deleteClips(ids: string[]): Promise<ClipClient[]> {
	if (ids.length === 0) return []

	const placeholders = ids.map((_id, index) => `$${index + 1}`).join(', ')

	const rows = await queryFn<ClipClient>(
		`
			WITH deleted AS (
				DELETE FROM ${CLIPS_TABLE} WHERE id IN (${placeholders})
				RETURNING *
			)
			SELECT 
				deleted.*,
				users.display_name AS creator_display_name
			FROM deleted
			LEFT JOIN ${USERS_TABLE} AS users
				ON deleted.creator_user_id = users.id
		`,
		ids,
	)

	return rows
}

async function saveAudioFile(audioFile: ServerAudioFile): Promise<ClientAudioFile> {
	const { id, creator_user_id, file_name, public_url, duration, created_at, color } = audioFile

	const rows = await queryFn<ClientAudioFile>(
		`
			WITH inserted AS (
				INSERT INTO ${AUDIOFILES_TABLE} (id, creator_user_id, file_name, public_url, duration, created_at, color) 
				VALUES ($1, $2, $3, $4, $5, $6, $7)
				RETURNING *
			)
			SELECT 
				inserted.*,
				users.display_name AS creator_display_name
			FROM inserted
			LEFT JOIN ${USERS_TABLE} AS users
				ON inserted.creator_user_id = users.id
		`,
		[id, creator_user_id, file_name, public_url, duration, created_at, color],
	)

	if (!rows.length) throw new DatabaseError('Failed to save audio file')

	const result = rows[0]!
	audioFileCache.set(result.id, result)
	return result
}

async function makeNewIfNotExistUser(
	user: Omit<User, 'created_at' | 'download_quality'>,
): Promise<User> {
	const {
		id,
		display_name,
		provider,
		provider_id,
		provider_email,
		roles,
		color,
		banned_at,
		ban_reason,
	} = user

	const rows = await queryFn<User>(
		`
			INSERT INTO ${USERS_TABLE} (id, display_name, provider, provider_id, provider_email, roles, color, banned_at, ban_reason) 
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
			ON CONFLICT (provider, provider_id) DO UPDATE
				SET
					provider_email=EXCLUDED.provider_email
			RETURNING *
		`,
		[
			id,
			display_name,
			provider,
			provider_id,
			provider_email,
			roles,
			color,
			banned_at,
			ban_reason,
		],
	)

	if (!rows.length) throw new DatabaseError('Failed to create or update user')

	const result = rows[0]!
	return result
}

async function saveSession(session: Omit<Session, 'created_at'>): Promise<Session> {
	const { session_id, user_id } = session

	const rows = await queryFn<Session>(
		`
			INSERT INTO ${SESSIONS_TABLE} (session_id, user_id) 
			VALUES ($1, $2)
			RETURNING *
		`,
		[session_id, user_id],
	)

	if (!rows.length) throw new Error('Failed to save session')

	const result = rows[0]!
	return result
}

async function deleteSession(session_id: string): Promise<Session> {
	const rows = await queryFn<Session>(
		`
			DELETE FROM ${SESSIONS_TABLE} WHERE session_id = $1 RETURNING *`,
		[session_id],
	)

	if (!rows.length) throw new NotFoundError('session', session_id)

	const result = rows[0]!
	return result
}

async function getUserFromSessionId(session_id: string): Promise<User> {
	const rows = await queryFn<User>(
		`
			SELECT u.* 
			FROM ${SESSIONS_TABLE} AS s
			JOIN ${USERS_TABLE} AS u ON s.user_id = u.id
			WHERE s.session_id = $1 AND s.created_at > NOW() - INTERVAL '7 days'
		`,
		[session_id],
	)

	if (!rows.length) throw new NotFoundError('session', session_id)

	const result = rows[0]!
	return result
}

async function updateExistingUsername(id: string, username: string): Promise<User['display_name']> {
	const rows = await queryFn<Pick<User, 'display_name'>>(
		`
			UPDATE ${USERS_TABLE}
			SET display_name = $2
			WHERE id = $1
			RETURNING display_name
		`,
		[id, username],
	)

	if (!rows.length) throw new NotFoundError('user', id)
	const result = rows[0]!

	return result.display_name
}

async function updateDownloadQuality(
	id: string,
	quality: User['download_quality'],
): Promise<User['download_quality']> {
	const rows = await queryFn<Pick<User, 'download_quality'>>(
		`
			UPDATE ${USERS_TABLE}
			SET download_quality = $2
			WHERE id = $1
			RETURNING download_quality
		`,
		[id, quality],
	)

	if (!rows.length) throw new NotFoundError('user', id)
	const result = rows[0]!

	return result.download_quality
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

	// Try to find the dev user first
	const rows = await queryFn<User>(
		`SELECT * FROM ${USERS_TABLE} WHERE provider_id = $1 AND provider = $2`,
		['dev-user-id', 'dev'],
	)

	if (rows.length > 0) {
		return rows[0]!
	}

	// Create if not exists
	const newUser: Omit<User, 'created_at' | 'download_quality'> = {
		id: nanoid(),
		display_name: 'Dev User',
		provider: 'dev',
		provider_id: 'dev-user-id',
		provider_email: 'dev@local.host',
		roles: ['admin', 'regular'],
		color: randomSafeHexColor(),
		banned_at: null,
		ban_reason: null,
	}

	return await makeNewIfNotExistUser(newUser)
}

async function deleteAudioFile(
	id: string,
): Promise<{ deleted_clips: ClipClient['id'][]; deleted_file: ServerAudioFile }> {
	const rows = await queryFn<ServerAudioFile & { deleted_clip_ids: ClipServer['id'][] | null }>(
		`
			WITH deleted_clips AS (
				DELETE FROM ${CLIPS_TABLE}
				WHERE audio_file_id = $1
				RETURNING id
			),
			deleted_file AS (
				DELETE FROM ${AUDIOFILES_TABLE}
				WHERE id = $1
				RETURNING *
			)
			SELECT 
				deleted_file.*,
				(SELECT array_agg(id) FROM deleted_clips) AS deleted_clip_ids
			FROM deleted_file
			`,
		[id],
	)

	if (!rows.length) throw new NotFoundError('audio file', id)
	const row = rows[0]!

	const { deleted_clip_ids, ...fileData } = row

	return {
		deleted_clips: deleted_clip_ids || [],
		deleted_file: fileData,
	}
}

async function deleteTrack(
	id: string,
): Promise<{ deleted_clips: ClipClient['id'][]; deleted_track: TrackServer }> {
	const rows = await queryFn<TrackServer & { deleted_clip_ids: ClipServer['id'][] | null }>(
		`
			WITH deleted_clips AS (
				DELETE FROM ${CLIPS_TABLE}
				WHERE track_id = $1
				RETURNING id
			),
			deleted_track AS (
				DELETE FROM ${TRACKS_TABLE}
				WHERE id = $1
				RETURNING *
			)
			SELECT 
				deleted_track.*,
				(SELECT array_agg(id) FROM deleted_clips) AS deleted_clip_ids
			FROM deleted_track
			`,
		[id],
	)

	if (!rows.length) throw new NotFoundError('track', id)
	const row = rows[0]!

	const { deleted_clip_ids, ...trackData } = row

	return {
		deleted_clips: deleted_clip_ids || [],
		deleted_track: trackData,
	}
}

type BanUserResult = {
	display_name: User['display_name']
	deleted_clips: ClipClient['id'][]
	deleted_audiofiles: Pick<ServerAudioFile, 'id' | 'file_name' | 'creator_user_id'>[]
}

async function banUser(
	userId: string,
	reason: string | null,
	deleteContent: boolean,
): Promise<BanUserResult> {
	const rows = await queryFn<Pick<User, 'display_name'>>(
		`
		UPDATE ${USERS_TABLE}
		SET 
			banned_at = NOW(), 
			ban_reason = $2,
			roles = CASE 
				WHEN NOT ('banned' = ANY(roles)) THEN array_append(roles, 'banned')
				ELSE roles
			END
		WHERE id = $1
		RETURNING display_name
	`,
		[userId, reason],
	)

	if (!rows.length) throw new NotFoundError('user', userId)
	const row = rows[0]!

	let deleted_clips: ClipClient['id'][] = []
	let deleted_audiofiles: Pick<ServerAudioFile, 'id' | 'file_name' | 'creator_user_id'>[] = []

	if (deleteContent) {
		const clipRows = await queryFn<Pick<ClipClient, 'id'>>(
			`
			DELETE FROM ${CLIPS_TABLE} 
			WHERE creator_user_id = $1
			OR audio_file_id IN (SELECT id FROM ${AUDIOFILES_TABLE} WHERE creator_user_id = $1)
			RETURNING id`,
			[userId],
		)

		const audioRows = await queryFn<
			Pick<ServerAudioFile, 'id' | 'file_name' | 'creator_user_id'>
		>(
			`DELETE FROM ${AUDIOFILES_TABLE} WHERE creator_user_id = $1 RETURNING id, file_name, creator_user_id`,
			[userId],
		)

		deleted_clips = clipRows.map((r) => r.id)
		deleted_audiofiles = audioRows
	}

	return {
		display_name: row.display_name,
		deleted_clips,
		deleted_audiofiles,
	}
}

async function unbanUser(userId: string): Promise<User['display_name']> {
	const rows = await queryFn<Pick<User, 'display_name'>>(
		`
		UPDATE ${USERS_TABLE}
		SET 
			banned_at = NULL, 
			ban_reason = NULL,
			roles = array_remove(roles, 'banned')
		WHERE id = $1
		RETURNING display_name
	`,
		[userId],
	)

	if (!rows.length) throw new NotFoundError('user', userId)
	const row = rows[0]!

	return row.display_name
}

async function getAllUsers(): Promise<User[]> {
	const rows = await queryFn<User>(`
		SELECT *
		FROM ${USERS_TABLE}
		ORDER BY display_name ASC
	`)
	return rows
}
