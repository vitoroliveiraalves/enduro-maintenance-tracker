import { expect, test } from '@playwright/test'
import { signUpFresh } from './helpers/login'
import { seedMockupBike } from './helpers/seed'

// A slow network used to leave a blank screen; now each screen shows grey rows until its data arrives.
const slow = (ms: number) => async (route: import('@playwright/test').Route) => {
  await new Promise((r) => setTimeout(r, ms))
  await route.continue()
}

test('garage, bike, history, shelf and invoices show a skeleton while loading, then the real rows', async ({ page }) => {
  await signUpFresh(page)
  const bikeId = await seedMockupBike(page.request, 'Skel Bike')

  await page.route('**/api/bikes', slow(1200))
  await page.goto('/')
  await expect(page.getByTestId('skeleton')).toBeVisible()
  await expect(page.getByTestId('bike-card')).toBeVisible()
  await expect(page.getByTestId('skeleton')).toHaveCount(0)
  await page.unroute('**/api/bikes')

  await page.route(`**/api/bikes/${bikeId}`, slow(1200))
  await page.goto(`/bikes/${bikeId}`)
  await expect(page.getByTestId('bike-loading')).toBeVisible()
  await expect(page.getByTestId('bike-name')).toHaveText('Skel Bike')
  await expect(page.getByTestId('bike-loading')).toHaveCount(0)

  await page.route('**/api/services**', slow(1200))
  await page.goto('/history')
  await expect(page.getByTestId('skeleton')).toBeVisible()
  await expect(page.getByTestId('history-service').first()).toBeVisible()
  await expect(page.getByTestId('skeleton')).toHaveCount(0)

  await page.route('**/api/parts', slow(1200))
  await page.goto('/shelf')
  await expect(page.getByTestId('skeleton')).toBeVisible()
  await expect(page.getByTestId('shelf-empty')).toBeVisible()
  await expect(page.getByTestId('skeleton')).toHaveCount(0)

  await page.route('**/api/documents', slow(1200))
  await page.goto('/invoice')
  await expect(page.getByTestId('skeleton')).toBeVisible()
  await expect(page.getByTestId('invoice-list-empty')).toBeVisible()
})
