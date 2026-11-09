import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../../server/db/client'
import { user } from '../../../server/db/schema'
import { createBike } from '../../../server/utils/bikes'
import { assertVoiceAllowed, VOICE_DAILY_COPY } from '../../../server/utils/rate-limit'
import { MAX_ROUNDS, parseVoiceInput, runVoice, wavSeconds } from '../../../server/utils/voice'
import { truncateUsers } from '../../support/truncate'

/** A PCM WAV header (16 kHz mono 16-bit) claiming `seconds` of audio, with `bytes` of data actually present. */
function wav(seconds: number, bytes = 32) {
  const rate = 16_000 * 2
  const b = Buffer.alloc(44 + bytes)
  b.write('RIFF', 0, 'ascii'); b.writeUInt32LE(36 + bytes, 4); b.write('WAVE', 8, 'ascii')
  b.write('fmt ', 12, 'ascii'); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22)
  b.writeUInt32LE(16_000, 24); b.writeUInt32LE(rate, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34)
  b.write('data', 36, 'ascii'); b.writeUInt32LE(Math.round(seconds * rate), 40)
  return b
}
const cfg = { apiKey: 'k', model: 'm', reader: '', dailyCap: 60, globalDailyCap: 600 }
const reply = (message: object) => new Response(JSON.stringify({ choices: [{ message }] }), { status: 200 })
const toolCall = (name: string, args: object, id = 'c1') => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } })

let uid: string
beforeEach(async () => {
  await truncateUsers()
  const [u] = await db.insert(user).values([{ name: 'A', email: 'a@example.com' }]).returning()
  uid = u!.id
})

describe('voice input', () => {
  it('reads WAV duration from the header; 90 s or non-WAV → 400', () => {
    expect(wavSeconds(wav(10))).toBeCloseTo(10)
    expect(() => parseVoiceInput([{ name: 'audio', data: wav(90) }])).toThrow(expect.objectContaining({ statusCode: 400 }))
    expect(() => parseVoiceInput([{ name: 'audio', data: Buffer.from('ID3 not a wav at all, some mp3 bytes here....') }])).toThrow(expect.objectContaining({ statusCode: 400 }))
    expect(parseVoiceInput([{ name: 'audio', data: wav(60) }]).audio).not.toBeNull()
    // A 'fmt ' chunk cut short by the end of the buffer is a 400, not a RangeError.
    const cut = Buffer.alloc(44)
    cut.write('RIFF', 0, 'ascii'); cut.write('WAVE', 8, 'ascii')
    cut.write('JUNK', 12, 'ascii'); cut.writeUInt32LE(8, 16)
    cut.write('fmt ', 28, 'ascii'); cut.writeUInt32LE(16, 32)
    expect(() => wavSeconds(cut)).toThrow(expect.objectContaining({ statusCode: 400 }))
  })
  it('a transcript skips audio; bad history, long transcript, bad tz and nothing → 400', () => {
    expect(parseVoiceInput([{ name: 'transcript', data: Buffer.from(' oil done ') }])).toMatchObject({ audio: null, transcript: 'oil done', tz: 'UTC' })
    const t = (s: string) => ({ name: 'transcript', data: Buffer.from(s) })
    for (const parts of [
      [],
      [t('x'.repeat(2001))],
      [t('ok'), { name: 'history', data: Buffer.from('{nope') }],
      [t('ok'), { name: 'history', data: Buffer.from(JSON.stringify([1, 2, 3, 4])) }],
      [t('ok'), { name: 'tz', data: Buffer.from('Mars/Base') }],
    ]) expect(() => parseVoiceInput(parts)).toThrow(expect.objectContaining({ statusCode: 400 }))
  })
})

describe('voice loop', () => {
  it(`stops after ${MAX_ROUNDS} tool rounds`, async () => {
    const f = vi.fn(async () => reply({ content: null, tool_calls: [toolCall('list_bikes', {})] }))
    const r = await runVoice(uid, { transcript: 'loop forever', history: [], tz: 'Europe/Lisbon' }, cfg, f as unknown as typeof fetch)
    expect(f).toHaveBeenCalledTimes(MAX_ROUNDS)
    expect(r.sources).toEqual([])
    expect(r.answer).toMatch(/couldn't finish/)
  })

  it('keeps only sources whose ref came from a tool this request, and validates proposals', async () => {
    const b = await createBike(uid, { clientId: crypto.randomUUID(), name: 'KTM', make: 'KTM', model: '300', year: 2022, stroke: '2T', hoursTenths: 100, km: 1000, items: [{ name: 'Oil', everyHoursTenths: 200 }] })
    let ref = ''
    const f = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { messages: Array<{ role: string; content: string }> }
      const tool = body.messages.find((m) => m.role === 'tool')
      if (!tool) return reply({ content: null, tool_calls: [toolCall('list_bikes', {})] })
      ref = (JSON.parse(tool.content) as { ref: string }).ref
      return reply({ content: null, tool_calls: [toolCall('answer', {
        answer: 'You have one bike.', sources: [ref, 'list_bikes#99999'],
        proposals: [{ kind: 'reading', bikeId: b.id, hoursTenths: 120 }, { kind: 'reading', bikeId: b.id, hoursTenths: 1.5 }],
      }, 'c2')] })
    })
    const r = await runVoice(uid, { transcript: 'how many bikes', history: [{ q: 'hi', a: 'hello' }], tz: 'Europe/Lisbon' }, cfg, f as unknown as typeof fetch)
    expect(r.answer).toBe('You have one bike.')
    expect(r.sources.map((s) => s.ref)).toEqual([ref])
    expect(r.sources[0]).toMatchObject({ tool: 'list_bikes' })
    expect(r.proposals).toEqual([{ kind: 'reading', bikeId: b.id, hoursTenths: 120 }])
    expect(r.notes).toHaveLength(1)
    const first = JSON.parse(String((f.mock.calls[0]![1] as RequestInit).body)) as { messages: Array<{ role: string; content: string }> }
    expect(first.messages[0]!.content).toContain('KTM')
    expect(first.messages[0]!.content).toContain('counts hours & km')
    expect(first.messages.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user'])
  })

  it('an OpenRouter error is a 502, not a 500', async () => {
    const f = vi.fn(async () => new Response('{}', { status: 500 }))
    await expect(runVoice(uid, { transcript: 'x', history: [], tz: 'UTC' }, cfg, f as unknown as typeof fetch)).rejects.toMatchObject({ statusCode: 502 })
  })
})

describe('voice caps', () => {
  it('daily cap per user, separate from invoices', () => {
    const now = Date.now()
    const u = `cap-${crypto.randomUUID()}`
    assertVoiceAllowed(u, 2, now)
    assertVoiceAllowed(u, 2, now + 1)
    expect(() => assertVoiceAllowed(u, 2, now + 2)).toThrow(expect.objectContaining({ statusCode: 429, statusMessage: VOICE_DAILY_COPY }))
  })
})
