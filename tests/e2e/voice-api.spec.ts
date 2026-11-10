import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { signUpFresh } from './helpers/login'
import { bikeBody } from './helpers/seed'

type VoiceResult = { transcript: string; answer: string | null; sources: Array<{ tool: string; ref: string }>; proposals: Array<Record<string, unknown>>; notes: string[] }

test('voice API with the mock reader: proposal, sourced answer, honest "don\'t know"', async ({ page }) => {
  await signUpFresh(page)
  const req = page.request
  expect((await (await req.get('/api/voice/status')).json())).toEqual({ available: true, off: false })

  const bike = (await (await req.post('/api/bikes', { data: bikeBody('Voice KTM', [{ name: 'Gearbox oil', everyHoursTenths: 200 }, { name: 'Air filter', everyHoursTenths: 50 }]) })).json()) as { id: string }
  const part = await req.post('/api/parts', { data: { clientId: crypto.randomUUID(), startClientId: crypto.randomUUID(), name: 'Exhaust gasket', qtyHundredths: 200 } })
  expect(part.ok()).toBeTruthy()
  const voice = async (multipart: Record<string, string | { name: string; mimeType: string; buffer: Buffer }>) => {
    const res = await req.post('/api/voice', { multipart })
    expect(res.status()).toBe(200)
    return (await res.json()) as VoiceResult
  }

  // A real WAV clip is accepted (the mock does not transcribe it).
  const clip = await voice({ audio: { name: 'note.wav', mimeType: 'audio/wav', buffer: readFileSync('tests/fixtures/voice/question-en.wav') } })
  expect(clip.transcript).toBe('mock transcript')

  const oil = await voice({ transcript: 'Changed the gearbox oil today', tz: 'Europe/Lisbon' })
  expect(oil.proposals).toHaveLength(1)
  expect(oil.proposals[0]).toMatchObject({ kind: 'service', bikeId: bike.id, by: 'diy' })
  expect(oil.answer).toBeNull()

  const gasket = await voice({ transcript: 'How many exhaust gaskets do I have?' })
  expect(gasket.answer).toBe('You have 2 pcs of Exhaust gasket.')
  expect(gasket.sources).toHaveLength(1)
  expect(gasket.sources[0]).toMatchObject({ tool: 'search_shelf' })

  const bearings = await voice({ transcript: 'When did I do the bearings?', history: JSON.stringify([{ q: 'hi', a: 'hello' }]) })
  expect(bearings.answer).toBe("I don't know from your records.")
  expect(bearings.sources).toEqual([])
  expect(bearings.proposals).toEqual([])
})

test('voice API needs a session', async ({ request }) => {
  expect((await request.post('/api/voice', { multipart: { transcript: 'oil' } })).status()).toBe(401)
})
