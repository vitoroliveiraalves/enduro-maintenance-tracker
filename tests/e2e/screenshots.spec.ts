import { test } from '@playwright/test'
import { loginAs } from './helpers/login'
import { seedMockupBike } from './helpers/seed'

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
