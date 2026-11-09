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
