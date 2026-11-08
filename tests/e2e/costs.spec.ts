import { expect, test } from '@playwright/test'
import type { APIRequestContext } from '@playwright/test'
import { signUpFresh } from './helpers/login'
import { bikeBody } from './helpers/seed'

async function bike(request: APIRequestContext, name: string) {
  const res = await request.post('/api/bikes', { data: bikeBody(name, [{ name: 'Gearbox oil', everyHoursTenths: 200 }]) })
  expect(res.ok()).toBeTruthy()
  return ((await res.json()) as { id: string }).id
}
async function expense(request: APIRequestContext, o: { bikeId: string | null; at: string; amountCents: number; categoryId: string; description: string }) {
  const res = await request.post('/api/expenses', { data: { clientId: crypto.randomUUID(), ...o } })
  expect(res.ok(), await res.text()).toBeTruthy()
}

test('year totals, month + one bike, URL state and CSV export', async ({ page }) => {
  await signUpFresh(page)
  const cats = (await (await page.request.get('/api/categories')).json()) as Array<{ id: string; name: string }>
  const cat = cats[0]!.id
  const a = await bike(page.request, 'Alpha')
  const b = await bike(page.request, 'Beta')
  await expense(page.request, { bikeId: a, at: '2025-10-06', amountCents: 8640, categoryId: cat, description: 'Wheel bearings' })
  await expense(page.request, { bikeId: a, at: '2025-10-11', amountCents: 12900, categoryId: cat, description: '=cmd tyre' })
  await expense(page.request, { bikeId: b, at: '2025-03-02', amountCents: 5000, categoryId: cat, description: 'Beta chain' })
  await expense(page.request, { bikeId: null, at: '2025-03-03', amountCents: 1000, categoryId: cat, description: 'Loose fuel' })

  await page.goto('/costs?period=year&date=2025-06-01')
  await expect(page.getByTestId('costs-total')).toHaveText('275,40 €')
  await expect(page.getByTestId('bar')).toHaveCount(12)
  await expect(page.getByRole('img', { name: 'October: 215,40 €' })).toBeVisible()
  await expect(page.getByTestId('costs-bike-row')).toHaveCount(3)
  await expect(page.getByTestId('kpi-hour')).toHaveText('—')
  if (process.env.SCREENSHOTS) await page.screenshot({ path: 'tests/e2e/__screenshots__/costs-year.png' })

  // Month + one bike, state in the URL, survives reload
  await page.getByTestId('costs-bike').selectOption({ label: 'Alpha' })
  await page.getByTestId('seg-month').click()
  await expect(page.getByTestId('period-label')).toHaveText('Jun 2025')
  await page.getByTestId('period-next').click() // 2025-06 -> 2025-07
  for (let i = 0; i < 3; i++) await page.getByTestId('period-next').click()
  await expect(page.getByTestId('period-label')).toHaveText('Oct 2025')
  await expect(page).toHaveURL(/bikeId=/)
  await expect(page).toHaveURL(/date=2025-10-01/)
  await page.reload()
  await expect(page.getByTestId('period-label')).toHaveText('Oct 2025')
  await expect(page.getByTestId('costs-total')).toHaveText('215,40 €')
  await expect(page.getByTestId('costs-expense')).toHaveCount(2)
  await expect(page.getByTestId('costs-expense').first()).toContainText('=cmd tyre')
  await page.getByTestId('period-prev').click()
  await expect(page.getByTestId('costs-empty')).toBeVisible()
  await page.getByTestId('period-next').click()
  await expect(page.getByTestId('period-label')).toHaveText('Oct 2025')
  await expect(page.getByTestId('costs-expense')).toHaveCount(2)
  if (process.env.SCREENSHOTS) await page.screenshot({ path: 'tests/e2e/__screenshots__/costs-month.png' })

  // CSV export
  const href = await page.getByTestId('export-csv').getAttribute('href')
  const res = await page.request.get(href!)
  expect(res.status()).toBe(200)
  expect(res.headers()['content-disposition']).toContain('enduro-costs-month-2025-10-01.csv')
  const text = await res.text()
  expect(text.charCodeAt(0)).toBe(0xfeff)
  expect(text).toContain('"date";"bike";"category";"description";"amount_eur";"invoice_number"')
  expect(text).toContain(`"'=cmd tyre";"129,00"`)
  expect(text).not.toContain('Beta chain')

  // someone else's bike id is a 404
  expect((await page.request.get('/api/costs?bikeId=00000000-0000-4000-8000-000000000000')).status()).toBe(404)
})
