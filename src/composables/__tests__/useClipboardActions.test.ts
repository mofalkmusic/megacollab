import { beforeAll, beforeEach, describe, expect, test, mock } from 'bun:test'
import { reactive, ref, shallowRef } from 'vue'
import type { Clip } from '~/schema'

const TOTAL_BEATS = 16 * 16

const clips = reactive<Map<string, Clip>>(new Map())
const selectedClipIds = reactive<Set<string>>(new Set())
const clipboardClips = shallowRef<any[] | null>(null)
const tracks = reactive<Map<string, { id: string; order_index: number }>>(new Map())
const user = ref<any>(null)
const pxPerBeat = shallowRef(40)
const bpm = 128
const currentPlayTimeBeats = shallowRef(0)

const socketCalls: Array<{ event: string; data: any }> = []
const logs: Array<{ sender: string; text: string }> = []

let nextAck:
	| { success: true; data: any[] }
	| { success: false; error: { message: string } }
	| ((event: string, data: any) => any) = { success: true, data: [] }

const emitWithAck = async (event: string, data: any) => {
	socketCalls.push({ event, data })
	if (typeof nextAck === 'function') return await nextAck(event, data)
	return nextAck
}

mock.module('@/state', () => ({
	clips,
	selectedClipIds,
	clipboardClips,
	tracks,
	user,
	pxPerBeat,
	bpm,
	TOTAL_BEATS,
}))

mock.module('@/audioEngine', () => ({
	currentPlayTimeBeats,
}))

mock.module('@/socket/socket', () => ({
	socket: {
		emitWithAck,
	},
}))

mock.module('@/composables/useConsole', () => ({
	useConsole: () => ({
		userLog: (sender: string, text: string) => {
			logs.push({ sender, text })
		},
	}),
}))

let useClipboardActions: (opts?: { bindKeyboard?: boolean }) => {
	copySelection: () => void
	pasteClips: () => Promise<void>
	duplicateSelection: () => Promise<void>
	deleteSelection: () => Promise<void>
}

function makeClip(partial: Partial<Clip> & { id: string }): Clip {
	return {
		id: partial.id,
		track_id: partial.track_id ?? 't1',
		audio_file_id: partial.audio_file_id ?? 'af1',
		creator_user_id: partial.creator_user_id ?? 'u1',
		creator_display_name: partial.creator_display_name ?? 'Test',
		start_beat: partial.start_beat ?? 0,
		end_beat: partial.end_beat ?? 4,
		offset_seconds: partial.offset_seconds ?? 0,
		gain: partial.gain ?? 1,
		muted: partial.muted ?? false,
		created_at: partial.created_at ?? new Date().toISOString(),
	}
}

beforeAll(async () => {
	;({ useClipboardActions } = await import('../useClipboardActions'))
})

beforeEach(() => {
	clips.clear()
	selectedClipIds.clear()
	tracks.clear()
	tracks.set('t1', { id: 't1', order_index: 0 })
	tracks.set('t2', { id: 't2', order_index: 1 })
	clipboardClips.value = null
	user.value = { id: 'u1', display_name: 'Test', banned_at: null }
	currentPlayTimeBeats.value = 0
	socketCalls.length = 0
	logs.length = 0
	nextAck = { success: true, data: [] }
})

describe('useClipboardActions', () => {
	test('pasteClips sends one batch request and skips out-of-bounds clips', async () => {
		clipboardClips.value = [
			{
				relStartBeat: 0,
				relEndBeat: 2,
				trackOffset: 0,
				audioFileId: 'af1',
				offsetSeconds: 0,
				gain: 1,
				muted: false,
			},
			{
				relStartBeat: 2,
				relEndBeat: 8,
				trackOffset: 0,
				audioFileId: 'af1',
				offsetSeconds: 0,
				gain: 1,
				muted: false,
			},
		]
		currentPlayTimeBeats.value = 254

		nextAck = (event, data) => {
			expect(event).toBe('get:clips:create:batch')
			expect(data.clips).toHaveLength(1)
			expect(data.clips[0]).toMatchObject({
				start_beat: 254,
				end_beat: 256,
			})
			return {
				success: true,
				data: [makeClip({ id: 'server_clip_1', start_beat: 254, end_beat: 256 })],
			}
		}

		const { pasteClips } = useClipboardActions({ bindKeyboard: false })
		await pasteClips()

		expect(socketCalls).toHaveLength(1)
		expect(clips.has('server_clip_1')).toBe(true)
		expect([...selectedClipIds]).toEqual(['server_clip_1'])
	})

	test('pasteClips out-of-bounds only does not emit and preserves selection', async () => {
		const existing = makeClip({ id: 'existing', start_beat: 8, end_beat: 10, track_id: 't1' })
		clips.set(existing.id, existing)
		selectedClipIds.add(existing.id)

		clipboardClips.value = [
			{
				relStartBeat: 0,
				relEndBeat: 2,
				trackOffset: 0,
				audioFileId: 'af1',
				offsetSeconds: 0,
				gain: 1,
				muted: false,
			},
		]
		currentPlayTimeBeats.value = TOTAL_BEATS

		const { pasteClips } = useClipboardActions({ bindKeyboard: false })
		await pasteClips()

		expect(socketCalls).toHaveLength(0)
		expect([...selectedClipIds]).toEqual([existing.id])
		expect(logs.some((l) => l.text.includes('Nothing pasted'))).toBe(true)
	})

	test('duplicateSelection sends one batch request for multi-clip selection', async () => {
		const c1 = makeClip({ id: 'c1', start_beat: 0, end_beat: 2, track_id: 't1' })
		const c2 = makeClip({ id: 'c2', start_beat: 2, end_beat: 4, track_id: 't1' })
		clips.set(c1.id, c1)
		clips.set(c2.id, c2)
		selectedClipIds.add(c1.id)
		selectedClipIds.add(c2.id)

		nextAck = (event, data) => {
			expect(event).toBe('get:clips:create:batch')
			expect(data.clips).toHaveLength(2)
			expect(data.clips[0]).toMatchObject({ start_beat: 4, end_beat: 6 })
			expect(data.clips[1]).toMatchObject({ start_beat: 6, end_beat: 8 })
			return {
				success: true,
				data: [
					makeClip({ id: 'dup1', start_beat: 4, end_beat: 6 }),
					makeClip({ id: 'dup2', start_beat: 6, end_beat: 8 }),
				],
			}
		}

		const { duplicateSelection } = useClipboardActions({ bindKeyboard: false })
		await duplicateSelection()

		expect(socketCalls).toHaveLength(1)
		expect(socketCalls[0]?.event).toBe('get:clips:create:batch')
		expect(clips.has('dup1')).toBe(true)
		expect(clips.has('dup2')).toBe(true)
		expect(new Set(selectedClipIds)).toEqual(new Set(['dup1', 'dup2']))
	})

	test('duplicateSelection out-of-bounds only does not emit and preserves selection', async () => {
		const c1 = makeClip({ id: 'c1', start_beat: 250, end_beat: 254, track_id: 't1' })
		const c2 = makeClip({ id: 'c2', start_beat: 254, end_beat: 256, track_id: 't1' })
		clips.set(c1.id, c1)
		clips.set(c2.id, c2)
		selectedClipIds.add(c1.id)
		selectedClipIds.add(c2.id)

		const { duplicateSelection } = useClipboardActions({ bindKeyboard: false })
		await duplicateSelection()

		expect(socketCalls).toHaveLength(0)
		expect(new Set(selectedClipIds)).toEqual(new Set(['c1', 'c2']))
		expect(logs.some((l) => l.text.includes('Nothing duplicated'))).toBe(true)
	})
})
