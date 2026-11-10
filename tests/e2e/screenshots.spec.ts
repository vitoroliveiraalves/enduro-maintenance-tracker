import { readFileSync } from 'node:fs'
import { test } from '@playwright/test'
import { loginAs, signUpFresh } from './helpers/login'
import { bikeBody, seedMockupBike } from './helpers/seed'

test.skip(!process.env.SCREENSHOTS, 'screenshots only with SCREENSHOTS=1')

test('bike screen and item history', async ({ page }) => {
  await loginAs(page)
  const id = await seedMockupBike(page.request, "KTM 300 EXC '23")
  await page.goto(`/bikes/${id}`)
  await page.getByTestId('item-row').first().waitFor()
  await page.screenshot({ path: 'tests/e2e/__screenshots__/bike-screen.png' })
  await page.getByTestId('item-row').filter({ hasText: 'Wheel bearings' }).click()
  await page.getByTestId('service-entry').first().waitFor()
  await page.screenshot({ path: 'tests/e2e/__screenshots__/item-history.png' })
})

test('invoice review', async ({ page }) => {
  await signUpFresh(page)
  const bike = await page.request.post('/api/bikes', {
    data: bikeBody("KTM 300 EXC '23", [
      { name: 'Gearbox oil', everyHoursTenths: 150 },
      { name: 'Wheel bearings', everyHoursTenths: 500, everyMonths: 12 },
    ]),
  })
  if (!bike.ok()) throw new Error('seed failed')
  await page.goto('/invoice')
  await page.getByTestId('file-input').setInputFiles('tests/e2e/fixtures/invoice-garage.jpg')
  await page.waitForURL(/\/invoice\/[0-9a-f-]{36}/, { timeout: 30_000 })
  await page.getByTestId('inv-line').nth(2).waitFor({ timeout: 15_000 })
  await page.getByTestId('viewer-image').evaluate((i: HTMLImageElement) => i.decode())
  await page.screenshot({ path: 'tests/e2e/__screenshots__/invoice-review.png' })
})

test('invoice review with a shelf line', async ({ page }) => {
  await signUpFresh(page)
  const bike = await page.request.post('/api/bikes', { data: bikeBody("KTM 300 EXC '23", [{ name: 'Wheel bearings', everyHoursTenths: 500, everyMonths: 12 }]) })
  if (!bike.ok()) throw new Error('seed failed')
  const part = await page.request.post('/api/parts', { data: { clientId: crypto.randomUUID(), name: 'Rolamentos 6004', qtyHundredths: 200, startClientId: crypto.randomUUID() } })
  if (!part.ok()) throw new Error('seed failed')
  await page.goto('/invoice')
  await page.getByTestId('file-input').setInputFiles('tests/e2e/fixtures/invoice-garage.jpg')
  await page.waitForURL(/\/invoice\/[0-9a-f-]{36}/, { timeout: 30_000 })
  const line = page.getByTestId('inv-line').nth(2)
  await line.waitFor({ timeout: 15_000 })
  await line.getByTestId('line-shelf').click()
  await line.getByTestId('line-shelf-pick').fill('rolam')
  await line.getByTestId('line-shelf-option').waitFor()
  await line.scrollIntoViewIfNeeded()
  await page.screenshot({ path: 'tests/e2e/__screenshots__/invoice-shelf-line.png' })
})

test('settings', async ({ page }) => {
  // Headless Chromium reports notifications as 'denied' and has no SW here: show a fresh phone's state.
  await page.addInitScript(() => {
    Object.defineProperty(Notification, 'permission', { get: () => 'default' })
    Object.defineProperty(ServiceWorkerContainer.prototype, 'ready', { get: () => Promise.resolve({ pushManager: { getSubscription: async () => null } }) })
  })
  await signUpFresh(page)
  const bike = await page.request.post('/api/bikes', { data: bikeBody("KTM 300 EXC '23", [{ name: 'Gearbox oil', everyHoursTenths: 150 }]) })
  if (!bike.ok()) throw new Error('seed failed')
  const { id } = (await bike.json()) as { id: string }
  const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10)
  for (const [title, dueOn, bikeId] of [['IUC', day(12), id], ['Insurance', day(80), null], ['Inspection', day(-3), id]] as const) {
    await page.request.post('/api/reminders', { data: { clientId: crypto.randomUUID(), title, dueOn, repeatYearly: true, ...(bikeId ? { bikeId } : {}) } })
  }
  await page.goto('/settings')
  await page.getByTestId('reminder-row').nth(2).waitFor()
  await page.getByTestId('push-toggle').waitFor()
  await page.screenshot({ path: 'tests/e2e/__screenshots__/settings.png' })
  await page.getByTestId('delete-confirm').fill('DELETE')
  await page.getByTestId('delete-account').scrollIntoViewIfNeeded()
  await page.screenshot({ path: 'tests/e2e/__screenshots__/settings-account.png' })
  await page.goto(`/bikes/${id}`)
  await page.getByTestId('reminder-chip').first().waitFor()
  await page.screenshot({ path: 'tests/e2e/__screenshots__/bike-reminder-chip.png' })
})

test('offline', async ({ page, context }) => {
  await loginAs(page)
  const id = await seedMockupBike(page.request, "KTM 300 EXC '23")
  await page.goto(`/bikes/${id}`)
  await page.getByTestId('item-row').first().waitFor()
  await context.setOffline(true)
  await page.getByTestId('log-ride').click()
  await page.getByTestId('hours-input').fill('144,0')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await page.getByTestId('pending-badge').waitFor()
  await page.screenshot({ path: 'tests/e2e/__screenshots__/offline.png' })
  await page.getByTestId('pending-badge').click()
  await page.getByTestId('pending-sheet').waitFor()
  await page.screenshot({ path: 'tests/e2e/__screenshots__/offline-pending-sheet.png' })
  await context.setOffline(false)
})

test('pending sheet with a set-aside write (Retry)', async ({ page, context }) => {
  await signUpFresh(page)
  const id = await seedMockupBike(page.request, "KTM 300 EXC '23")
  await page.route('**/api/readings', (route) =>
    route.request().method() === 'POST'
      ? route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ statusCode: 400, statusMessage: "Couldn't reach the server after several tries (503)" }) })
      : route.fallback(),
  )
  await page.goto(`/bikes/${id}`)
  await page.getByTestId('item-row').first().waitFor()
  await context.setOffline(true)
  await page.getByTestId('log-ride').click()
  await page.getByTestId('hours-input').fill('144,0')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await context.setOffline(false)
  await page.getByText("1 change couldn't be saved").waitFor()
  await page.getByTestId('pending-badge').click()
  await page.getByTestId('pending-retry').waitFor()
  await page.screenshot({ path: 'tests/e2e/__screenshots__/offline-retry.png' })
})

test('smoke: home', async ({ page }) => {
  await page.goto('/')
  await page.getByText('Enduro Tracker').first().waitFor()
  await page.screenshot({ path: 'tests/e2e/__screenshots__/task-1-smoke.png' })
})

test('item notes', async ({ page }) => {
  await loginAs(page)
  const id = await seedMockupBike(page.request, "KTM 300 EXC '23")
  const detail = (await (await page.request.get(`/api/bikes/${id}`)).json()) as { items: Array<{ id: string; name: string }> }
  const chain = detail.items.find((i) => i.name === 'Chain & sprockets')!
  await page.goto(`/bikes/${id}/items/${chain.id}`)
  await page.getByTestId('note-add').click()
  await page.getByTestId('note-sheet').getByRole('button', { name: 'Torque specs', exact: true }).click()
  await page.getByLabel('Spec 1 name').fill('Rear sprocket bolts')
  await page.getByLabel('Spec 1 value').fill('35 Nm')
  await page.getByLabel('Spec 2 name').fill('Rear axle nut')
  await page.getByLabel('Spec 2 value').fill('90 Nm')
  await page.getByTestId('note-body').fill('1. Loosen the axle nut\n2. Set slack to 50–55 mm at the swingarm block\n3. Blue Loctite on sprocket bolts')
  await page.getByTestId('note-photo-input').setInputFiles('tests/e2e/fixtures/invoice-garage.jpg')
  await page.getByTestId('note-photo-new').waitFor()
  await page.screenshot({ path: 'tests/e2e/__screenshots__/note-sheet.png' })
  await page.getByTestId('note-save').click()
  await page.getByTestId('note-card').waitFor()
  await page.getByTestId('toast').waitFor({ state: 'detached', timeout: 6000 })
  await page.getByTestId('note-card').scrollIntoViewIfNeeded()
  await page.screenshot({ path: 'tests/e2e/__screenshots__/item-notes.png' })
})

test.describe('install popup', () => {
  test.use({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1' })
  test('iPhone steps', async ({ page }) => {
    await signUpFresh(page)
    const id = await seedMockupBike(page.request, "KTM 300 EXC '23")
    await page.goto(`/bikes/${id}`)
    await page.getByTestId('install-popup').waitFor()
    await page.screenshot({ path: 'tests/e2e/__screenshots__/install-popup-ios.png' })
  })
})

test('install popup (Chrome/Android)', async ({ page }) => {
  await signUpFresh(page)
  const id = await seedMockupBike(page.request, "KTM 300 EXC '23")
  await page.goto(`/bikes/${id}`)
  await page.getByTestId('item-row').first().waitFor()
  await page.evaluate(() => {
    const e = new Event('beforeinstallprompt', { cancelable: true }) as Event & Record<string, unknown>
    e.prompt = async () => {}
    e.userChoice = Promise.resolve({ outcome: 'dismissed' })
    window.dispatchEvent(e)
  })
  await page.getByTestId('install-popup').waitFor()
  await page.screenshot({ path: 'tests/e2e/__screenshots__/install-popup-android.png' })
})

test('shelf and part sheet', async ({ page }) => {
  await signUpFresh(page)
  const bike = await page.request.post('/api/bikes', { data: bikeBody("KTM 300 EXC '23", [{ name: 'Gearbox oil', everyHoursTenths: 150 }, { name: 'Air filter clean', everyHoursTenths: 50 }]) })
  if (!bike.ok()) throw new Error('seed failed')
  const bikeId = ((await bike.json()) as { id: string }).id
  const mk = async (name: string, qty: number, extra: object = {}) => {
    const r = await page.request.post('/api/parts', { data: { clientId: crypto.randomUUID(), name, qtyHundredths: qty, startClientId: crypto.randomUUID(), ...extra } })
    if (!r.ok()) throw new Error('seed failed')
  }
  await mk('Junta escape', 200, { bikeId, minHundredths: 100 })
  await mk('Vela NGK BR8ES', 100, { bikeId, minHundredths: 300 })
  await mk('Óleo motor', 150, { unit: 'L' })
  await mk('Cabo de embraiagem', 0, { bikeId })
  await page.goto('/shelf')
  await page.getByTestId('part-row').nth(3).waitFor()
  await page.screenshot({ path: 'tests/e2e/__screenshots__/shelf.png' })
  await page.getByTestId('part-row').filter({ hasText: 'Vela' }).click()
  await page.getByTestId('part-minus').click()
  await page.getByTestId('part-plus').click()
  await page.getByTestId('part-item').first().waitFor()
  await page.getByTestId('part-history').waitFor()
  await page.screenshot({ path: 'tests/e2e/__screenshots__/part-sheet.png' })
})

test('mark done with parts and the bike stock mark', async ({ page }) => {
  await signUpFresh(page)
  const day = new Date().toISOString().slice(0, 10)
  const bike = (await (await page.request.post('/api/bikes', {
    data: bikeBody("KTM 300 EXC '23", [
      { name: 'Engine oil', everyHoursTenths: 200, lastDone: { at: day, hoursTenths: 1250, km: 3000 } },
      { name: 'Air filter clean', everyHoursTenths: 50, lastDone: { at: day, hoursTenths: 1400, km: 3700 } },
      { name: 'Chain & sprockets', everyKm: 1500, lastDone: { at: day, hoursTenths: 1100, km: 2900 } },
    ]),
  })).json()) as { id: string }
  const detail = (await (await page.request.get(`/api/bikes/${bike.id}`)).json()) as { items: Array<{ id: string; name: string }> }
  const idOf = (n: string) => detail.items.find((i) => i.name === n)!.id
  const mk = async (name: string, qty: number, extra: object = {}) => {
    const r = await page.request.post('/api/parts', { data: { clientId: crypto.randomUUID(), name, qtyHundredths: qty, startClientId: crypto.randomUUID(), bikeId: bike.id, ...extra } })
    if (!r.ok()) throw new Error('seed failed')
  }
  await mk('Oil filter', 100, { itemIds: [idOf('Engine oil')] })
  await mk('Air filter', 0, { itemIds: [idOf('Air filter clean')] })
  await mk('Motorex 10W-50', 150, { unit: 'L' })
  await page.goto(`/bikes/${bike.id}`)
  await page.getByTestId('item-stock').first().waitFor()
  await page.screenshot({ path: 'tests/e2e/__screenshots__/bike-stock.png' })
  await page.getByTestId('item-row').filter({ hasText: 'Engine oil' }).click()
  await page.getByTestId('mark-done').click()
  await page.getByTestId('parts-used-row').first().waitFor()
  await page.getByTestId('parts-add-open').click()
  await page.getByTestId('parts-add').fill('motorex')
  await page.getByTestId('parts-add-option').waitFor()
  await page.screenshot({ path: 'tests/e2e/__screenshots__/mark-done-parts.png' })
})

test('shopping list', async ({ page }) => {
  await signUpFresh(page)
  const bike = await page.request.post('/api/bikes', { data: bikeBody("KTM 300 EXC '23", [{ name: 'Gearbox oil', everyHoursTenths: 150 }, { name: 'Wheel bearings', everyHoursTenths: 500 }]) })
  if (!bike.ok()) throw new Error('seed failed')
  const { id } = (await bike.json()) as { id: string }
  const detail = (await (await page.request.get(`/api/bikes/${id}`)).json()) as { items: Array<{ id: string; name: string }> }
  const mk = (name: string, extra: object) => page.request.post('/api/parts', { data: { clientId: crypto.randomUUID(), name, startClientId: crypto.randomUUID(), ...extra } })
  await mk('Two-stroke oil', { unit: 'L', qtyHundredths: 150, minHundredths: 200, bikeId: id })
  await mk('Spark plug NGK', { qtyHundredths: 100, minHundredths: 200, bikeId: id })
  await mk('Rolamentos 6004', { qtyHundredths: 0, bikeId: id, itemIds: [detail.items[1]!.id] })
  const entry = (text: string, extra: object = {}) => page.request.post('/api/shopping', { data: { clientId: crypto.randomUUID(), text, ...extra } })
  await entry('Chain lube', { bikeId: id })
  await entry('Zip ties')
  const done = (await (await entry('Brake fluid DOT 4')).json()) as { id: string }
  await page.request.patch(`/api/shopping/${done.id}`, { data: { done: true } })
  await page.goto('/shelf')
  await page.getByTestId('shelf-tab-buy').click()
  await page.getByTestId('buy-manual').nth(2).waitFor()
  await page.screenshot({ path: 'tests/e2e/__screenshots__/shopping.png' })
})

test('add bike km only and a street bike', async ({ page }) => {
  await signUpFresh(page)
  await page.goto('/bikes/new')
  await page.getByLabel('Name').fill('CB 500')
  await page.getByLabel('Make').fill('Honda')
  await page.getByLabel('Model').fill('CB500F')
  await page.getByText('4T', { exact: true }).click()
  await page.getByTestId('meters-choice').getByText('Km only').click()
  await page.getByLabel('Current km').fill('3812')
  await page.screenshot({ path: 'tests/e2e/__screenshots__/add-bike-km-only.png' })
  await page.getByRole('button', { name: 'Next: maintenance items' }).click()
  await page.getByRole('button', { name: 'Save bike' }).click()
  await page.waitForURL(/\/bikes\/[0-9a-f-]{36}$/)
  await page.getByTestId('item-row').first().waitFor()
  await page.screenshot({ path: 'tests/e2e/__screenshots__/street-bike.png' })
})

test('mic on the bike screen, idle and recording', async ({ page }) => {
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
  await signUpFresh(page)
  const id = await seedMockupBike(page.request, "KTM 300 EXC '23")
  await page.goto(`/bikes/${id}`)
  await page.getByTestId('item-row').first().waitFor()
  await page.getByTestId('mic').waitFor()
  await page.screenshot({ path: 'tests/e2e/__screenshots__/mic.png' })
  await page.getByTestId('mic').click()
  await page.getByTestId('mic-recording').waitFor()
  await page.waitForTimeout(1200)
  await page.screenshot({ path: 'tests/e2e/__screenshots__/mic-recording.png' })
  await page.getByTestId('mic-cancel').click()
})

test('voice review card and a sourced answer', async ({ page }) => {
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
  await signUpFresh(page)
  const id = await seedMockupBike(page.request, "KTM 300 EXC '23")
  await page.request.post('/api/parts', { data: { clientId: crypto.randomUUID(), startClientId: crypto.randomUUID(), name: 'Junta escape (exhaust gasket)', qtyHundredths: 200 } })
  await page.goto(`/bikes/${id}`)
  await page.getByTestId('mic').click()
  await page.waitForTimeout(400)
  await page.getByTestId('mic').click()
  const t = page.getByTestId('voice-transcript')
  await t.waitFor()
  await t.fill('Changed the engine oil today at 143')
  await page.getByTestId('voice-resend').click()
  await page.getByTestId('voice-card').waitFor()
  await page.screenshot({ path: 'tests/e2e/__screenshots__/voice-review.png' })
  await t.fill('How many exhaust gaskets do I have?')
  await page.getByTestId('voice-resend').click()
  await page.getByTestId('voice-source').first().waitFor()
  await page.screenshot({ path: 'tests/e2e/__screenshots__/voice-answer.png' })
  // Talk again from the sheet: clear "listening" state while recording.
  await page.getByTestId('voice-followup').click()
  await page.getByTestId('voice-recording').waitFor()
  await page.waitForTimeout(500)
  await page.screenshot({ path: 'tests/e2e/__screenshots__/voice-talk-again.png' })
})

test('correct total sheet', async ({ page }) => {
  await loginAs(page)
  const id = await seedMockupBike(page.request, "KTM 300 EXC '23")
  await page.goto(`/bikes/${id}`)
  await page.getByTestId('correct-total').click()
  await page.getByTestId('correct-hours').waitFor()
  await page.screenshot({ path: 'tests/e2e/__screenshots__/correct-total.png' })
})

test('invoices list, saved invoice and delete with a stock warning', async ({ page }) => {
  await signUpFresh(page)
  const bike = await page.request.post('/api/bikes', { data: bikeBody("KTM 300 EXC '23", [{ name: 'Wheel bearings', everyHoursTenths: 500, everyMonths: 12 }]) })
  if (!bike.ok()) throw new Error('seed failed')
  const bikeId = ((await bike.json()) as { id: string }).id
  const cats = (await (await page.request.get('/api/categories')).json()) as Array<{ id: string; kind: string }>
  const cat = (k: string) => cats.find((c) => c.kind === k)!.id
  const up = await page.request.post('/api/documents', {
    multipart: { clientId: crypto.randomUUID(), files: { name: 'invoice.jpg', mimeType: 'image/jpeg', buffer: readFileSync('tests/e2e/fixtures/invoice-garage.jpg') } },
  })
  const docId = ((await up.json()) as { id: string }).id
  const partClientId = crypto.randomUUID()
  const ok = await page.request.post(`/api/documents/${docId}/confirm`, {
    data: {
      clientId: crypto.randomUUID(), bikeId, at: '2026-11-02', garageName: 'Moto Garage Braga', forceTotals: true,
      lines: [
        { description: 'Pneu Michelin Enduro Medium 140/80-18', amountCents: 12900, categoryId: cat('tyres') },
        { description: 'Mão de obra', amountCents: 3000, categoryId: cat('labour') },
        { description: 'Junta escape', amountCents: 5640, categoryId: cat('parts'), shelf: { clientId: crypto.randomUUID(), partClientId, name: 'Junta escape', qtyHundredths: 200 } },
      ],
    },
  })
  if (!ok.ok()) throw new Error(`confirm failed ${ok.status()}`)
  const parts = (await (await page.request.get('/api/parts')).json()) as Array<{ id: string }>
  await page.request.post(`/api/parts/${parts[0]!.id}/movements`, { data: { clientId: crypto.randomUUID(), qtyHundredths: -300 } })
  await page.request.post('/api/documents', {
    multipart: { clientId: crypto.randomUUID(), files: { name: 'b.jpg', mimeType: 'image/jpeg', buffer: readFileSync('tests/e2e/fixtures/invoice-qr.jpg') } },
  })

  await page.goto('/invoice')
  await page.getByTestId('invoice-row').nth(1).waitFor()
  await page.getByTestId('invoice-list').scrollIntoViewIfNeeded()
  await page.screenshot({ path: 'tests/e2e/__screenshots__/invoices-list.png' })
  await page.goto(`/invoice/${docId}`)
  await page.getByTestId('saved-lines').waitFor()
  await page.getByTestId('viewer-image').evaluate((i: HTMLImageElement) => i.decode())
  await page.getByTestId('change').scrollIntoViewIfNeeded()
  await page.screenshot({ path: 'tests/e2e/__screenshots__/invoice-saved.png' })
  await page.getByTestId('delete').click()
  await page.getByTestId('delete-ask').scrollIntoViewIfNeeded()
  await page.screenshot({ path: 'tests/e2e/__screenshots__/invoice-delete.png' })
})

test('looks: garage and bike in Stamped Steel and the tricolor', async ({ page }) => {
  await signUpFresh(page)
  const id = await seedMockupBike(page.request, "KTM 300 EXC '23")
  const cb = await page.request.post('/api/bikes', { data: { ...bikeBody('CB500F', []), make: 'Honda', model: 'CB500F', year: 2020, stroke: '4T', meters: 'km', km: 12040 } })
  if (!cb.ok()) throw new Error('seed failed')
  for (const look of ['steel', 'tricolor'] as const) {
    await page.goto('/settings')
    await page.getByRole('radio', { name: look === 'steel' ? /Stamped Steel/ : /Old-school tricolor/ }).check()
    await page.goto('/')
    await page.getByTestId('bike-card').nth(1).waitFor()
    await page.screenshot({ path: `tests/e2e/__screenshots__/look-${look}-garage.png` })
    await page.goto(`/bikes/${id}`)
    await page.getByTestId('item-row').first().waitFor()
    await page.screenshot({ path: `tests/e2e/__screenshots__/look-${look}-bike.png` })
  }
})
