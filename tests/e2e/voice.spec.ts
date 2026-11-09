import { expect, test, type Page } from '@playwright/test'
import { signUpFresh } from './helpers/login'
import { bikeBody } from './helpers/seed'

/** A fake microphone: a 440 Hz tone through Web Audio, so the real recorder and WAV encoder run. */
async function fakeMic(page: Page) {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const ctx = new AudioContext()
      const osc = ctx.createOscillator()
      const dest = ctx.createMediaStreamDestination()
      osc.connect(dest)
      osc.start()
      return dest.stream
    }
  })
}

test('mic: hidden on login, hold to talk, offline note waits and is answered online', async ({ page, context }) => {
  await fakeMic(page)
  await page.goto('/login')
  await expect(page.getByTestId('mic')).toHaveCount(0)

  await signUpFresh(page)
  const bike = (await (await page.request.post('/api/bikes', { data: bikeBody('Mic KTM', [{ name: 'Gearbox oil', everyHoursTenths: 200 }]) })).json()) as { id: string }
  await page.goto(`/bikes/${bike.id}`)
  const mic = page.getByTestId('mic')
  await expect(mic).toBeVisible()

  // Hold → recording UI with seconds; release → POST /api/voice with a WAV.
  const sent: Array<{ type: string; size: number }> = []
  await page.route('/api/voice', async (route) => {
    const body = route.request().postDataBuffer() ?? Buffer.alloc(0)
    sent.push({ type: route.request().headers()['content-type'] ?? '', size: body.length })
    await route.fulfill({ json: { transcript: 'How much oil?', answer: 'Not in your records.', sources: [], proposals: [], notes: [] } })
  })
  await mic.hover()
  await page.mouse.down()
  await expect(page.getByTestId('mic-recording')).toBeVisible()
  await expect(page.getByTestId('mic-seconds')).toHaveText('0:01', { timeout: 3000 })
  await page.mouse.up()
  await expect(page.getByTestId('voice-answer-text')).toHaveText('Not in your records.')
  expect(sent).toHaveLength(1)
  expect(sent[0]!.type).toContain('multipart/form-data')
  expect(sent[0]!.size).toBeGreaterThan(16_000) // ≥ ~0.5 s of 16 kHz 16-bit audio
  await expect(mic).toBeHidden() // hidden while a sheet is open
  await page.getByTestId('sheet-close').click()
  await expect(mic).toBeVisible()
  await page.unroute('/api/voice')

  // Offline: a short tap starts, a second tap stops; the note is kept on the phone.
  await context.setOffline(true)
  await expect(page.getByTestId('app-offline-banner')).toBeVisible()
  await mic.click()
  await expect(page.getByTestId('mic-recording')).toBeVisible()
  await page.waitForTimeout(600)
  await mic.click()
  await expect(page.getByTestId('pending-badge')).toHaveText('1 voice note waiting')

  // Back online: sent to the (mock) server, answered, opened from the badge.
  await context.setOffline(false)
  await expect(page.getByTestId('pending-badge')).toHaveText('Voice note ready', { timeout: 15_000 })
  await page.getByTestId('pending-badge').click()
  await expect(page.getByTestId('voice-transcript')).toHaveValue('mock transcript')
  await page.getByTestId('sheet-close').click()
  await expect(page.getByTestId('pending-badge')).toBeHidden()
})

test('review sheet: edit and save a card, remove one, sourced answer, honest "don\'t know"', async ({ page }) => {
  await fakeMic(page)
  await signUpFresh(page)
  const req = page.request
  const bike = (await (await req.post('/api/bikes', { data: { ...bikeBody('Review KTM', [{ name: 'Engine oil', everyHoursTenths: 200 }]), hoursTenths: 1500 } })).json()) as { id: string }
  expect((await req.post('/api/parts', { data: { clientId: crypto.randomUUID(), startClientId: crypto.randomUUID(), name: 'Junta escape (exhaust gasket)', qtyHundredths: 200 } })).ok()).toBeTruthy()
  await page.goto(`/bikes/${bike.id}`)

  // A short note opens the sheet; the transcript can be corrected and sent again.
  await page.getByTestId('mic').click()
  await expect(page.getByTestId('mic-recording')).toBeVisible()
  await page.waitForTimeout(400)
  await page.getByTestId('mic').click()
  const transcript = page.getByTestId('voice-transcript')
  await expect(transcript).toHaveValue('mock transcript')
  const ask = async (text: string) => {
    await transcript.fill(text)
    await page.getByTestId('voice-resend').click()
    await expect(page.getByTestId('voice-listening')).toBeHidden()
    await expect(transcript).toHaveValue(text)
  }

  // Removing the only card leaves nothing to save, and nothing is written.
  const services: string[] = []
  page.on('request', (r) => { if (r.method() === 'POST' && r.url().endsWith('/api/services')) services.push(r.url()) })
  await ask('changed the oil')
  await expect(page.getByTestId('voice-card')).toHaveCount(1)
  await page.getByTestId('card-remove').click()
  await expect(page.getByTestId('voice-card')).toHaveCount(0)
  await expect(page.getByTestId('voice-save')).toHaveCount(0)

  // Edit the hours (comma accepted) and save through the services route.
  await ask('changed the oil at 143')
  const card = page.getByTestId('voice-card')
  await expect(card).toContainText('Mark maintenance done')
  await expect(card.getByLabel('Engine oil')).toBeChecked()
  await card.getByTestId('card-hours').fill('143,5')
  // A follow-up question before saving keeps the unsaved card and its edits.
  await page.getByTestId('voice-followup').click()
  await page.waitForTimeout(400)
  await page.getByTestId('voice-followup').click()
  await expect(transcript).toHaveValue('mock transcript')
  await expect(card).toHaveCount(1)
  await expect(card.getByTestId('card-hours')).toHaveValue('143,5')
  await page.getByTestId('voice-save').click()
  await expect(card.getByTestId('card-status')).toHaveText('Saved')
  expect(services).toHaveLength(1)

  // Answers show the facts they come from.
  await ask('do I have a gasket')
  await expect(page.getByTestId('voice-answer-text')).toHaveText('You have 2 pcs of Junta escape (exhaust gasket).')
  await expect(page.getByTestId('voice-source')).toHaveCount(1)
  await expect(page.getByTestId('voice-source')).toContainText('Junta escape (exhaust gasket) · 2')
  await expect(page.getByTestId('voice-speak')).toBeVisible()
  await ask('when did I do the bearings')
  await expect(page.getByTestId('voice-answer-text')).toHaveText("I don't know from your records.")
  await expect(page.getByTestId('voice-source')).toHaveCount(0)

  await page.getByTestId('sheet-close').click()
  await page.goto('/history')
  await expect(page.getByTestId('history-service').first()).toContainText('143.5 h')
})

test('register page names voice notes in the privacy note', async ({ page }) => {
  await page.goto('/register')
  await expect(page.getByText("Invoice photos and voice notes are sent to an AI service (via OpenRouter) to read them; voice notes aren't kept.")).toBeVisible()
})
