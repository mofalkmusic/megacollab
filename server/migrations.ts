import {
	AUDIOFILES_TABLE,
	CLIPS_TABLE,
	SESSIONS_TABLE,
	TRACKS_TABLE,
	USERS_TABLE,
	type QueryHandler,
} from './database'

export type Migration = {
	id: number
	name: string
	func: (query: QueryHandler) => Promise<void>
}

/**
 * These happen top to bottom
 * New ones go at the bottom yes!
 */
export const migrations: Migration[] = [
	{
		id: 1,
		name: 'initial_schema',
		func: async (queryFn) => {
			await queryFn(`
                CREATE TABLE IF NOT EXISTS ${USERS_TABLE} (
                    id TEXT PRIMARY KEY,
                    provider TEXT NOT NULL,
                    provider_id TEXT NOT NULL,
                    provider_email TEXT NOT NULL,
                    created_at TIMESTAMPTZ DEFAULT NOW(),
                    display_name TEXT NOT NULL,
                    color TEXT NOT NULL,
                    roles TEXT[] NOT NULL DEFAULT '{regular}' CHECK (array_length(roles, 1) >= 1),
                    UNIQUE (provider, provider_id)
                )
            `)

			await queryFn(`
                CREATE TABLE IF NOT EXISTS ${AUDIOFILES_TABLE} (
                    id TEXT PRIMARY KEY,
                    creator_user_id TEXT NOT NULL REFERENCES ${USERS_TABLE}(id) ON DELETE CASCADE ON UPDATE CASCADE,
                    file_name TEXT NOT NULL,
                    public_url TEXT NOT NULL,
                    duration DOUBLE PRECISION NOT NULL,
                    created_at TIMESTAMPTZ DEFAULT NOW(),
                    color TEXT NOT NULL
                )`)

			await queryFn(`
                CREATE TABLE IF NOT EXISTS ${TRACKS_TABLE} (
                    id TEXT PRIMARY KEY,
                    creator_user_id TEXT NOT NULL REFERENCES ${USERS_TABLE}(id) ON DELETE CASCADE ON UPDATE CASCADE,
                    belongs_to_user_id TEXT REFERENCES ${USERS_TABLE}(id) ON DELETE CASCADE ON UPDATE CASCADE,
                    title TEXT,
                    order_index INTEGER NOT NULL,
                    gain DOUBLE PRECISION NOT NULL,
                    created_at TIMESTAMPTZ DEFAULT NOW()
                )`)

			await queryFn(`
                CREATE TABLE IF NOT EXISTS ${CLIPS_TABLE} (
                    id TEXT PRIMARY KEY,
                    track_id TEXT NOT NULL REFERENCES ${TRACKS_TABLE}(id) ON DELETE CASCADE ON UPDATE CASCADE,
                    audio_file_id TEXT NOT NULL REFERENCES ${AUDIOFILES_TABLE}(id) ON DELETE CASCADE ON UPDATE CASCADE,
                    creator_user_id TEXT NOT NULL REFERENCES ${USERS_TABLE}(id) ON DELETE CASCADE ON UPDATE CASCADE,
                    start_beat DOUBLE PRECISION NOT NULL,
                    end_beat DOUBLE PRECISION NOT NULL,
                    offset_seconds DOUBLE PRECISION NOT NULL,
                    gain DOUBLE PRECISION NOT NULL,
                    created_at TIMESTAMPTZ DEFAULT NOW()
                )`)

			await queryFn(`
                CREATE TABLE IF NOT EXISTS ${SESSIONS_TABLE} (
                    session_id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL REFERENCES ${USERS_TABLE}(id) ON DELETE CASCADE ON UPDATE CASCADE,
                    created_at TIMESTAMPTZ DEFAULT NOW()
                )`)
		},
	},
	{
		id: 2,
		name: 'add_banned_columns',
		func: async (queryFn) => {
			await queryFn(`
                ALTER TABLE ${USERS_TABLE} 
                ADD COLUMN IF NOT EXISTS banned_at TIMESTAMPTZ,
                ADD COLUMN IF NOT EXISTS ban_reason TEXT
            `)
		},
	},
]
