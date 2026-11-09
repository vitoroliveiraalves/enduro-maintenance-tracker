import { expect, test } from '@playwright/test'
import { signUpFresh } from './helpers/login'

const T = '\u202f'
// Hours like "142.5 h" or "20h": a km-only bike must never show one.
const HOURS = /\d(\.\d)? ?h\b/

export async function addStreetBike(page: import('@playwright/test').Page, name: string) {
  await page.goto('/bikes/new')
  await page.getByLabel('Name').fill(name)
  await page.getByLabel('Make').fill('Honda')
  await page.getByLabel('Model').fill('CB500F')
  await page.getByText('4T', { exact: true }).click()
  await page.getByTestId('meters-choice').getByText('Km only').click()
  await expect(page.getByLabel('Current hours')).toHaveCount(0)
  await page.getByLabel('Current km').fill('3812')
  await page.getByRole('button', { name: 'Next: maintenance items' }).click()
  await expect(page.getByLabel('Chain clean & lube every km')).toHaveValue('1000')
  await expect(page.getByLabel('Engine oil + filter every hours')).toHaveCount(0)
  await page.getByRole('button', { name: 'Save bike' }).click()
  await expect(page).toHaveURL(/\/bikes\/[0-9a-f-]{36}$/)
  return page.url().split('/').pop()!
}

test('street bike: add with km only, log a ride, mark done, switch meters, costs per km', async ({ page }) => {
  await signUpFresh(page)
  const bikeId = await addStreetBike(page, 'CB 500')

  // Bike screen: km only, no hours anywhere in its rows.
  await expect(page.getByTestId('km-value')).toHaveText(`3${T}812`)
  await expect(page.getByTestId('hours-value')).toHaveCount(0)
  for (const t of await page.getByTestId('item-row').allTextContents()) expect(t).not.toMatch(HOURS)

  // Log ride: one meter field, no riding conditions.
  await page.getByTestId('log-ride').click()
  await expect(page.getByTestId('hours-input')).toHaveCount(0)
  await expect(page.getByTestId('cond-mud')).toHaveCount(0)
  await page.getByTestId('km-input').fill('4100')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByTestId('log-sheet')).toBeHidden()
  await expect(page.getByTestId('km-value')).toHaveText(`4${T}100`)
  await expect(page.getByTestId('toast')).not.toContainText(HOURS)

  // Mark done: no hours field.
  await page.getByTestId('item-row').filter({ hasText: 'Chain clean & lube' }).click()
  await expect(page.getByTestId('iv-hours')).toHaveCount(0)
  await page.getByTestId('mark-done').click()
  await expect(page.getByTestId('md-hours')).toHaveCount(0)
  await expect(page.getByTestId('md-km')).toHaveValue('4100')
  await page.getByTestId('md-save').click()
  await expect(page.getByTestId('item-state')).not.toHaveText('Unknown')
  await page.getByTestId('back-to-bike').click()

  // Home card: km only.
  await page.goto('/')
  const card = page.getByTestId('bike-card').filter({ has: page.getByText('CB 500', { exact: true }) })
  await expect(card).toContainText(`4${T}100 km`)
  await expect(card).not.toContainText(HOURS)

  // Costs with only this bike: no hours tiles, per-km on the bike line.
  const cat = ((await (await page.request.get('/api/categories')).json()) as Array<{ id: string }>)[0]!.id
  const today = new Date().toISOString().slice(0, 10)
  const ex = await page.request.post('/api/expenses', { data: { clientId: crypto.randomUUID(), at: today, amountCents: 5000, categoryId: cat, bikeId, description: 'Chain lube' } })
  expect(ex.ok()).toBeTruthy()
  await page.goto('/costs')
  await expect(page.getByTestId('costs-kpis')).toBeVisible()
  await expect(page.getByTestId('kpi-hours')).toHaveCount(0)
  await expect(page.getByTestId('kpi-hour')).toHaveCount(0)
  await expect(page.getByTestId('kpi-km-total')).toBeVisible()
  await expect(page.getByTestId('costs-bike-row').first()).not.toContainText(HOURS)

  // Switch to Hours & km and back: hours appear, then go again; nothing lost.
  await page.goto(`/bikes/${bikeId}`)
  await page.getByTestId('bike-meters').getByText('Hours & km').click()
  await page.getByTestId('bike-meters-save').click()
  await expect(page.getByTestId('hours-value')).toBeVisible()
  await page.getByTestId('bike-meters').getByText('Km only').click()
  await page.getByTestId('bike-meters-save').click()
  await expect(page.getByTestId('hours-value')).toHaveCount(0)
  await expect(page.getByTestId('km-value')).toHaveText(`4${T}100`)
})

test('street bike: a ride logged offline syncs without hours', async ({ page, context }) => {
  await signUpFresh(page)
  const bikeId = await addStreetBike(page, 'Scooter')
  await expect(page.getByTestId('km-value')).toHaveText(`3${T}812`)

  await context.setOffline(true)
  await expect(page.getByTestId('app-offline-banner')).toBeVisible()
  await page.getByTestId('log-ride').click()
  await page.getByTestId('km-input').fill('3950')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByTestId('log-sheet')).toBeHidden()
  await expect(page.getByTestId('km-value')).toHaveText(`3${T}950`)
  await expect(page.getByTestId('pending-badge')).toHaveText('1 change waiting')

  await context.setOffline(false)
  await expect(page.getByTestId('pending-badge')).toBeHidden()
  const readings = (await (await page.request.get(`/api/readings/${bikeId}`)).json()) as Array<{ hoursTenths: number | null; km: number }>
  expect(readings[0]).toMatchObject({ hoursTenths: null, km: 3950 })
})
