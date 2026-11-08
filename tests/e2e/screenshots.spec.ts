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
