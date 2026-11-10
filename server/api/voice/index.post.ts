import { createError, defineEventHandler, getHeader, readMultipartFormData } from 'h3'
import { requireUser } from '../../utils/require-user'
import { assertVoiceAllowed } from '../../utils/rate-limit'
import { aiEnabled } from '../../utils/admin'
import { AI_OFF, mockVoice, MAX_AUDIO_BYTES, NOT_SET_UP, parseVoiceInput, runVoice, transcribe, voiceAvailable, voiceConfig } from '../../utils/voice'

const MAX_REQUEST_BYTES = MAX_AUDIO_BYTES + 64 * 1024

/** A voice note (WAV) or a corrected transcript → answer + proposals. Never writes data; audio is not kept. */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const cfg = voiceConfig(event)
  if (!voiceAvailable(cfg)) throw createError({ statusCode: 503, statusMessage: NOT_SET_UP })
  if (!(await aiEnabled(user.id))) throw createError({ statusCode: 403, statusMessage: AI_OFF })
  const len = Number(getHeader(event, 'content-length'))
  if (!Number.isFinite(len) || len > MAX_REQUEST_BYTES) throw createError({ statusCode: 400, statusMessage: 'Voice note too long — keep it under a minute.' })
  const parts = ((await readMultipartFormData(event)) ?? []).slice(0, 6).map((p) => ({ name: p.name, data: Buffer.from(p.data) }))
  const input = parseVoiceInput(parts)
  // Counted only once the input is valid: every request that reaches the model is one use.
  assertVoiceAllowed(user.id, cfg.dailyCap, Date.now(), cfg.globalDailyCap)

  const t0 = Date.now()
  const mock = cfg.reader === 'mock'
  const transcript = input.transcript ?? (mock ? 'mock transcript' : await transcribe(input.audio!, cfg))
  const result = mock ? await mockVoice(user.id, transcript) : await runVoice(user.id, { transcript, history: input.history, tz: input.tz }, cfg)
  console.info(`[voice] audio=${input.audio?.length ?? 0}B transcript=${transcript.length}ch ${Date.now() - t0}ms`)
  return result
})
