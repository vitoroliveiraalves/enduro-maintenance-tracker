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
