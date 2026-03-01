import { beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import type { Clip } from '~/schema'
import type { ServerEmitPayload } from '~/events'

type DbModule = typeof import('../database')
type HistoryModule = typeof import('../history')

let db: DbModule['db']
let USERS_TABLE: DbModule['USERS_TABLE']
let history: HistoryModule['history']

const nowIso = () => new Date().toISOString()
const rid = (prefix: string) => `${prefix}_${Math.random().toString(36).slice(2, 10)}`

async function createFixture() {
	const userId = rid('user')
	const providerId = rid('provider')
	const audioFileId = rid('af')
	const trackId = rid('track')

	await db.makeNewIfNotExistUserSafe({
		id: userId,
		display_name: 'Test User',
		provider: 'dev',
		provider_id: providerId,
		provider_email: `${providerId}@local.test`,
		roles: ['regular'],
		color: '#3399ff',
		banned_at: null,
		ban_reason: null,
	})

	await db.saveAudioFile({
		id: audioFileId,
		creator_user_id: userId,
		file_name: `${audioFileId}.wav`,
		public_url: 'https://example.test/audio.wav',
		duration: 8,
		created_at: nowIso(),
		color: '#88cc88',
	})

	await db.createTrack({
		id: trackId,
		creator_user_id: userId,
		belongs_to_user_id: null,
		title: 'Track',
		gain: 1,
		created_at: nowIso(),
	})

	return { userId, audioFileId, trackId }
}

function makeClip(
	overrides: Partial<Omit<Clip, 'created_at' | 'creator_display_name'>> = {},
): Omit<Clip, 'created_at' | 'creator_display_name'> {
	return {
		id: rid('clip'),
		creator_user_id: overrides.creator_user_id ?? 'missing-user',
		track_id: overrides.track_id ?? 'missing-track',
		audio_file_id: overrides.audio_file_id ?? 'missing-audio',
		start_beat: overrides.start_beat ?? 0,
		end_beat: overrides.end_beat ?? 4,
		offset_seconds: overrides.offset_seconds ?? 0,
		gain: overrides.gain ?? 1,
		muted: overrides.muted ?? false,
	}
}

beforeAll(async () => {
	Bun.env['ENV'] = 'development'
	Bun.env['DEV_DATABASE_FOLDER'] = 'dev.database.test'

	const databaseMod = await import('../database')
	const historyMod = await import('../history')

	db = databaseMod.db
	USERS_TABLE = databaseMod.USERS_TABLE
	history = historyMod.history

	await db.migrateAndSeedDb()
})

beforeEach(async () => {
	// Cascades remove tracks/audiofiles/clips created by previous tests.
	await db.query(`DELETE FROM ${USERS_TABLE}`)
})

describe('Clip batch creation', () => {
	test('createClipsBatch inserts all clips and preserves input order', async () => {
		const { userId, audioFileId, trackId } = await createFixture()

		const clipA = makeClip({
			creator_user_id: userId,
			audio_file_id: audioFileId,
			track_id: trackId,
			start_beat: 0,
			end_beat: 2,
			offset_seconds: 0.1,
			gain: 0.8,
			muted: false,
		})
		const clipB = makeClip({
			creator_user_id: userId,
			audio_file_id: audioFileId,
			track_id: trackId,
			start_beat: 2,
			end_beat: 4,
			offset_seconds: 0.2,
			gain: 1.2,
			muted: true,
		})

		const created = await db.createClipsBatch([clipA, clipB])

		expect(created).toHaveLength(2)
		expect(created.map((c) => c.id)).toEqual([clipA.id, clipB.id])
		expect(created[0]?.gain).toBe(0.8)
		expect(created[1]?.muted).toBe(true)

		const storedA = await db.getClip(clipA.id)
		const storedB = await db.getClip(clipB.id)

		expect(storedA?.id).toBe(clipA.id)
		expect(storedB?.id).toBe(clipB.id)
		expect(storedB?.end_beat).toBe(4)
	})
})

describe('History undo for batch clip creation', () => {
	test('undo removes all clips from a CLIP_CREATE_BATCH action', async () => {
		const { userId, audioFileId, trackId } = await createFixture()

		const clipA = makeClip({
			creator_user_id: userId,
			audio_file_id: audioFileId,
			track_id: trackId,
			start_beat: 4,
			end_beat: 6,
		})
		const clipB = makeClip({
			creator_user_id: userId,
			audio_file_id: audioFileId,
			track_id: trackId,
			start_beat: 6,
			end_beat: 8,
		})

		const created = await db.createClipsBatch([clipA, clipB])

		history.push({
			type: 'CLIP_CREATE_BATCH',
			data: {
				payload: {
					clips: [clipA, clipB].map((clip) => ({
						start_beat: clip.start_beat,
						end_beat: clip.end_beat,
						audio_file_id: clip.audio_file_id,
						track_id: clip.track_id,
						offset_seconds: clip.offset_seconds,
						gain: clip.gain,
						muted: clip.muted,
					})),
					ids: created.map((clip) => clip.id),
				},
				inverse: created.map((clip) => clip.id),
			},
			userId,
		})

		const emittedDeletes: Array<ServerEmitPayload<'clip:delete'>> = []

		const result = await history.undo(userId, (event, payload) => {
			if (event === 'clip:delete' && typeof payload === 'string') {
				emittedDeletes.push(payload)
			}
		})

		expect(result).toEqual({ success: true })
		expect(emittedDeletes).toHaveLength(2)
		expect(emittedDeletes).toEqual(created.map((clip) => clip.id))

		for (const clip of created) {
			expect(await db.getClip(clip.id)).toBeNull()
		}
	})
})
