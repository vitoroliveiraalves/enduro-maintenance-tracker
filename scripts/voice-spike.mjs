#!/usr/bin/env node
/**
 * Voice model check (plan Task 9). Run it yourself with your own key:
 *
 *   node --env-file=.env scripts/voice-spike.mjs
 *
 * Reads NUXT_OPENROUTER_API_KEY (and optional NUXT_VOICE_MODEL / NUXT_OPENROUTER_MODEL)
 * from the process environment only. Never prints the key or request headers:
 * only PASS/FAIL, the model, the transcript and error messages from OpenRouter.
 *
 * 1. Transcribe a 16 kHz mono WAV (Portuguese) sent as input_audio.
 * 2. Make a tool call from a text request (one dummy lookup tool).
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const key = process.env.NUXT_OPENROUTER_API_KEY
if (!key) {
  console.error('NUXT_OPENROUTER_API_KEY not set')
  process.exit(1)
}
const model = process.env.NUXT_VOICE_MODEL || process.env.NUXT_OPENROUTER_MODEL || 'google/gemini-3.1-flash-lite'
const wav = readFileSync(fileURLToPath(new URL('../tests/fixtures/voice/oil-change-pt.wav', import.meta.url)))

async function call(body) {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'X-Title': 'Enduro Tracker voice check' },
    body: JSON.stringify({ model, ...body }),
    signal: AbortSignal.timeout(60_000),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${json?.error?.message ?? 'no message'}`)
  return json
}

let ok = true
console.log(`model: ${model}`)

try {
  const t0 = Date.now()
  const r = await call({
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Transcribe this audio exactly, in its own language. Reply with the transcript only.' },
          { type: 'input_audio', input_audio: { data: wav.toString('base64'), format: 'wav' } },
        ],
      },
    ],
  })
  const text = String(r.choices?.[0]?.message?.content ?? '').trim()
  const pass = /óleo|oleo/i.test(text) && /filtro/i.test(text)
  ok &&= pass
  console.log(`1. transcribe WAV: ${pass ? 'PASS' : 'FAIL'} (${Date.now() - t0} ms)\n   transcript: ${text || '(empty)'}`)
} catch (e) {
  ok = false
  console.log(`1. transcribe WAV: FAIL\n   ${e.message}`)
}

try {
  const t0 = Date.now()
  const r = await call({
    messages: [{ role: 'user', content: 'How many hours since the last oil change on my KTM? Use the tool.' }],
    tools: [
      {
        type: 'function',
        function: {
          name: 'item_status',
          description: 'Maintenance status of one bike',
          parameters: { type: 'object', properties: { bikeName: { type: 'string' } }, required: ['bikeName'] },
        },
      },
    ],
    tool_choice: 'auto',
  })
  const calls = r.choices?.[0]?.message?.tool_calls ?? []
  const pass = calls.some((c) => c.function?.name === 'item_status')
  ok &&= pass
  console.log(`2. tool call:      ${pass ? 'PASS' : 'FAIL'} (${Date.now() - t0} ms)\n   calls: ${calls.map((c) => `${c.function?.name}(${c.function?.arguments})`).join(', ') || '(none)'}`)
} catch (e) {
  ok = false
  console.log(`2. tool call:      FAIL\n   ${e.message}`)
}

process.exit(ok ? 0 : 1)
