import { countsHours, countsKm, METERS_LABEL } from '../../shared/utils/meters'
import { createError, type H3Event } from 'h3'
import { isObj, itemRows, listBikes } from './bikes'
import { runTool, VOICE_TOOLS, type ToolDef } from './voice-tools'
import { validateProposals, type Proposal } from './voice-proposals'
import { VOICE_DAILY_CAP, VOICE_GLOBAL_DAILY_CAP } from './rate-limit'

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'
export const MAX_AUDIO_BYTES = 2.5 * 1024 * 1024
export const MAX_AUDIO_SECONDS = 62
export const MAX_TRANSCRIPT = 2000
export const MAX_ROUNDS = 6
const TIMEOUT_MS = 60_000

export type VoiceResult = {
  transcript: string
  answer: string | null
  sources: Array<{ tool: string; ref: string; data: unknown }>
  proposals: Proposal[]
  notes: string[]
}
export type VoiceInput = { audio: Buffer | null; transcript: string | null; history: Array<{ q: string; a: string }>; tz: string }
export type VoiceCfg = { apiKey: string; model: string; reader: string; dailyCap: number; globalDailyCap: number }

export const NOT_SET_UP = "Voice isn't set up on this server."
export const DONT_KNOW = "I don't know from your records."
const FAILED = "Voice couldn't be processed — try again."

export function voiceConfig(event: H3Event): VoiceCfg {
  const c = useRuntimeConfig(event)
  return {
    apiKey: String(c.openrouterApiKey ?? ''),
    model: String(c.voiceModel || c.openrouterModel || 'google/gemini-3.1-flash-lite'),
    reader: String(c.voiceReader ?? ''),
    dailyCap: Number(c.voiceDailyCap) || VOICE_DAILY_CAP,
    globalDailyCap: Number(c.voiceGlobalDailyCap) || VOICE_GLOBAL_DAILY_CAP,
  }
}
export const voiceAvailable = (cfg: Pick<VoiceCfg, 'apiKey' | 'reader'>) => !!cfg.apiKey || cfg.reader === 'mock'

const bad = (msg: string) => createError({ statusCode: 400, statusMessage: msg })

/** Seconds of audio in a PCM WAV, from its header; anything that isn't a WAV is a 400. */
export function wavSeconds(buf: Buffer): number {
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') throw bad('Audio must be a WAV recording.')
  let byteRate = 0
  let off = 12
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4)
    const size = buf.readUInt32LE(off + 4)
    if (id === 'fmt ') {
      if (size < 16 || off + 24 > buf.length) break
      byteRate = buf.readUInt32LE(off + 16)
    }
    if (id === 'data') {
      if (!byteRate) break
      return size / byteRate
    }
    off += 8 + size + (size % 2)
  }
  throw bad('Audio must be a WAV recording.')
}

function validTz(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

/** Multipart fields → checked input. Every refusal here happens before a use is counted. */
export function parseVoiceInput(parts: Array<{ name?: string; data: Buffer }>): VoiceInput {
  const field = (n: string) => parts.find((p) => p.name === n)?.data.toString('utf8')
  const audioPart = parts.find((p) => p.name === 'audio' && p.data.length)
  const transcript = field('transcript')?.trim() || null
  if (transcript && transcript.length > MAX_TRANSCRIPT) throw bad('Transcript too long.')
  let audio: Buffer | null = null
  if (!transcript) {
    if (!audioPart) throw bad('Send a voice note or a transcript.')
    if (audioPart.data.length > MAX_AUDIO_BYTES) throw bad('Voice note too long — keep it under a minute.')
    if (wavSeconds(audioPart.data) > MAX_AUDIO_SECONDS) throw bad('Voice note too long — keep it under a minute.')
    audio = audioPart.data
  }
  let history: VoiceInput['history'] = []
  const h = field('history')
  if (h) {
    let parsed: unknown
    try {
      parsed = JSON.parse(h)
    } catch {
      throw bad('Invalid history')
    }
    if (!Array.isArray(parsed) || parsed.length > 3) throw bad('Invalid history')
    history = parsed.map((x) => {
      if (!isObj(x) || typeof x.q !== 'string' || typeof x.a !== 'string' || x.q.length > MAX_TRANSCRIPT || x.a.length > MAX_TRANSCRIPT) throw bad('Invalid history')
      return { q: x.q, a: x.a }
    })
  }
  const tzRaw = field('tz')?.trim() || 'UTC'
  if (tzRaw.length > 64 || !validTz(tzRaw)) throw bad('Invalid tz')
  return { audio, transcript, history, tz: tzRaw }
}

export const todayIn = (tz: string, now = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(now)

type Msg = { role: 'system' | 'user' | 'assistant' | 'tool'; content: unknown; tool_calls?: ToolCall[]; tool_call_id?: string }
type ToolCall = { id: string; type: 'function'; function: { name: string; arguments: string } }
type Completion = { choices?: Array<{ message?: { content?: string | null; tool_calls?: ToolCall[] } }> }

async function call(body: object, cfg: VoiceCfg, fetchImpl: typeof fetch): Promise<Completion> {
  let res: Response
  try {
    res = await fetchImpl(OPENROUTER_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json', 'X-Title': 'Enduro Tracker' },
      body: JSON.stringify({ model: cfg.model, ...body }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch {
    throw createError({ statusCode: 502, statusMessage: FAILED })
  }
  if (!res.ok) throw createError({ statusCode: 502, statusMessage: FAILED })
  try {
    return (await res.json()) as Completion
  } catch {
    throw createError({ statusCode: 502, statusMessage: FAILED })
  }
}

/** Step (a): audio → transcript. */
export async function transcribe(audio: Buffer, cfg: VoiceCfg, fetchImpl: typeof fetch = fetch): Promise<string> {
  const r = await call({
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: 'Transcribe this audio exactly, in its own language (usually Portuguese or English). Reply with the transcript only.' },
        { type: 'input_audio', input_audio: { data: audio.toString('base64'), format: 'wav' } },
      ],
    }],
  }, cfg, fetchImpl)
  const text = String(r.choices?.[0]?.message?.content ?? '').trim().slice(0, MAX_TRANSCRIPT)
  if (!text) throw createError({ statusCode: 422, statusMessage: "Couldn't hear anything — try again closer to the phone." })
  return text
}

const ANSWER_TOOL: ToolDef = {
  type: 'function',
  function: {
    name: 'answer',
    description: 'Finish: the reply to the rider, the refs of tool results it relies on, and any record changes to propose.',
    parameters: {
      type: 'object',
      properties: {
        answer: { type: ['string', 'null'], description: 'Short reply in the rider\'s language; null when only proposing changes.' },
        sources: { type: 'array', items: { type: 'string' }, description: 'refs of the tool results the answer uses' },
        proposals: {
          type: 'array',
          description: 'Changes for the rider to review. Ids only from tool results; use candidates when unsure.',
          items: {
            type: 'object',
            properties: {
              kind: { type: 'string', enum: ['reading', 'correct_total', 'service', 'use_part', 'add_part', 'shopping', 'expense', 'reminder'] },
              bikeId: { type: 'string' }, candidates: { type: 'array', items: { type: 'string' } },
              itemIds: { type: 'array', items: { type: 'string' } }, itemCandidates: { type: 'array', items: { type: 'string' } },
              partId: { type: 'string' }, categoryId: { type: 'string' },
              hoursTenths: { type: 'integer' }, km: { type: 'integer' }, at: { type: 'string', description: 'YYYY-MM-DD' },
              by: { type: 'string', enum: ['diy', 'garage'] }, garageName: { type: 'string' }, notes: { type: 'string' },
              partsUsed: { type: 'array', items: { type: 'object', properties: { partId: { type: 'string' }, qtyHundredths: { type: 'integer' } } } },
              qtyHundredths: { type: 'integer' }, name: { type: 'string' }, unit: { type: 'string' }, text: { type: 'string' },
              amountCents: { type: 'integer' }, description: { type: 'string' },
              title: { type: 'string' }, dueOn: { type: 'string', description: 'YYYY-MM-DD' }, repeatYearly: { type: 'boolean' },
            },
            required: ['kind'],
          },
        },
      },
      required: ['answer'],
    },
  },
}

async function systemPrompt(userId: string, today: string): Promise<string> {
  const bikes = await listBikes(userId)
  const garage = bikes.length
    ? bikes.map((b) => `- ${b.name} (${b.make} ${b.model}, id ${b.id}): counts ${METERS_LABEL[b.meters].toLowerCase()}${countsHours(b.meters) ? '' : ' — never ask for or propose hours'}${countsKm(b.meters) ? '' : ' — never ask for or propose km'}`).join('\n')
    : '- (no bikes yet)'
  return [
    'You are the voice assistant of a motorcycle maintenance app. The rider speaks Portuguese or English; reply in the language they used.',
    `Today is ${today}. Resolve "today", "yesterday", "last Saturday" to YYYY-MM-DD dates.`,
    `The rider's bikes:\n${garage}`,
    'Look things up with the tools. Units: hours are integer tenths (142.5 h = 1425), money integer cents, quantities integer hundredths (2 pcs = 200).',
    'Never state a number, date or name that a tool did not return. If the records don\'t say, answer exactly that you don\'t know from the records.',
    'When the rider reports something done (a ride, a service, a part used or bought, a cost, a reminder), propose the change; never claim it is saved — the rider reviews and saves it.',
    'A ride or a new reading is kind "reading"; hours and km can only go up. When the rider says the total was wrong or asks to set/correct the bike\'s hours or km (it may go down), propose kind "correct_total" with the right totals instead.',
    'Proposals use ids from tool results only. If unsure which bike, item, part or category, give candidates (ids) instead of one id.',
    'Always finish by calling the answer tool, listing in sources the refs of the tool results you used.',
  ].join('\n\n')
}

const DONE_ROUNDS = "I couldn't finish looking that up — try asking more simply."

/** Step (b): the bounded tool loop on the transcript. Never writes data. */
export async function runVoice(userId: string, input: { transcript: string; history: VoiceInput['history']; tz: string }, cfg: VoiceCfg, fetchImpl: typeof fetch = fetch, now = new Date()): Promise<VoiceResult> {
  const messages: Msg[] = [
    { role: 'system', content: await systemPrompt(userId, todayIn(input.tz, now)) },
    ...input.history.flatMap((h): Msg[] => [{ role: 'user', content: h.q }, { role: 'assistant', content: h.a }]),
    { role: 'user', content: input.transcript },
  ]
  const results = new Map<string, { tool: string; data: unknown }>()
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const msg = (await call({ messages, tools: [...VOICE_TOOLS, ANSWER_TOOL], tool_choice: 'auto' }, cfg, fetchImpl)).choices?.[0]?.message
    const calls = msg?.tool_calls ?? []
    const fin = calls.find((c) => c.function?.name === 'answer')
    if (fin || !calls.length) {
      let a: Record<string, unknown> = {}
      if (fin) {
        try {
          const parsed = JSON.parse(fin.function.arguments || '{}')
          if (isObj(parsed)) a = parsed
        } catch { /* empty answer below */ }
      } else {
        a = { answer: msg?.content ?? null }
      }
      const refs = Array.isArray(a.sources) ? a.sources.map((s) => (isObj(s) ? s.ref : s)).filter((r): r is string => typeof r === 'string') : []
      const sources = [...new Set(refs)].filter((r) => results.has(r)).map((ref) => ({ ref, ...results.get(ref)! }))
      const { proposals, notes } = await validateProposals(userId, a.proposals)
      const answer = typeof a.answer === 'string' && a.answer.trim() ? a.answer.trim().slice(0, 2000) : null
      return { transcript: input.transcript, answer, sources, proposals, notes }
    }
    messages.push({ role: 'assistant', content: msg?.content ?? null, tool_calls: calls })
    for (const c of calls) {
      let args: unknown = {}
      try {
        args = JSON.parse(c.function?.arguments || '{}')
      } catch { /* tool answers with its own error */ }
      const { ref, result } = await runTool(userId, String(c.function?.name ?? ''), args, now)
      results.set(ref, { tool: String(c.function?.name), data: result })
      messages.push({ role: 'tool', tool_call_id: c.id, content: JSON.stringify({ ref, result }) })
    }
  }
  return { transcript: input.transcript, answer: DONE_ROUNDS, sources: [], proposals: [], notes: [] }
}

/** e2e stand-in: no network, a few fixed rules over the rider's real data. */
export async function mockVoice(userId: string, transcript: string, now = new Date()): Promise<VoiceResult> {
  const base: VoiceResult = { transcript, answer: null, sources: [], proposals: [], notes: [] }
  const t = transcript.toLowerCase()
  if (t.includes('oil')) {
    for (const b of await listBikes(userId)) {
      const item = (await itemRows(b.id, userId, now)).find((i) => /oil/i.test(i.name))
      if (!item) continue
      const { proposals, notes } = await validateProposals(userId, [{ kind: 'service', bikeId: b.id, itemIds: [item.id], at: todayIn('UTC', now), by: 'diy' }])
      return { ...base, proposals, notes }
    }
    return base
  }
  if (t.includes('gasket')) {
    const { ref, result } = await runTool(userId, 'search_shelf', { query: 'gasket' }, now)
    const found = result as Array<{ name: string; qtyHundredths: number; unit: string }>
    if (!found.length) return { ...base, answer: DONT_KNOW }
    const p = found[0]!
    return { ...base, answer: `You have ${p.qtyHundredths / 100} ${p.unit} of ${p.name}.`, sources: [{ tool: 'search_shelf', ref, data: result }] }
  }
  if (t.includes('bearing')) {
    for (const b of await listBikes(userId)) {
      const { ref, result } = await runTool(userId, 'item_status', { bikeId: b.id }, now)
      const item = (result as { items: Array<{ name: string; lastDone: { at: string | null } | null }> }).items.find((i) => /bearing/i.test(i.name) && i.lastDone?.at)
      if (item) return { ...base, answer: `Last done on ${item.lastDone!.at}.`, sources: [{ tool: 'item_status', ref, data: result }] }
    }
    return { ...base, answer: DONT_KNOW }
  }
  return base
}
