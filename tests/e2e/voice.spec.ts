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
  await expect(page.getByTestId('voice-answer')).toHaveText('Not in your records.')
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
  await expect(page.getByTestId('voice-transcript')).toHaveText('mock transcript')
  await page.getByTestId('sheet-close').click()
  await expect(page.getByTestId('pending-badge')).toBeHidden()
})
