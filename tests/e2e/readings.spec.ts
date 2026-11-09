import { expect, test } from '@playwright/test'
import { loginAs, sql } from './helpers/login'
import { seedMockupBike } from './helpers/seed'

test('log ride: comma decimal, condition, typo guards, replay-safe', async ({ page }) => {
  await loginAs(page)
  await page.getByTestId('add-bike').click()
  await page.getByLabel('Name').fill('Log Bike')
  await page.getByLabel('Make').fill('KTM')
  await page.getByLabel('Model').fill('300 EXC')
  await page.getByLabel('Current hours').fill('142,5')
  await page.getByLabel('Current km').fill('3812')
  await page.getByRole('button', { name: 'Next: maintenance items' }).click()
  const draft = page.getByTestId('item-draft').filter({ has: page.locator('input[aria-label="Item name"]') }).first()
  await draft.locator('summary').click()
  await page.getByLabel('Gearbox oil last done hours').fill('122')
  const airDraft = page.getByTestId('item-draft').filter({ has: page.getByLabel('Air filter clean every hours') })
  await airDraft.locator('summary').click()
  await page.getByLabel('Air filter clean last done hours').fill('100')
  await page.getByRole('button', { name: 'Save bike' }).click()
  await expect(page).toHaveURL(/\/bikes\/[0-9a-f-]{36}$/)
  const bikeId = page.url().split('/').pop()!
  await expect(page.getByTestId('hours-value')).toHaveText('142.5 h')
  const air = page.getByTestId('item-row').filter({ hasText: 'Air filter clean' })
  const index = () => page.getByTestId('item-row').evaluateAll((rows) => rows.findIndex((r) => r.textContent?.includes('Air filter clean')))
  const before = await index()
  const stateBefore = await air.getByTestId('item-state').textContent()

  // Typed with a comma, Mud: hours card updates and the air filter (50 h, x1.5 in mud) climbs the list
  await page.getByTestId('log-ride').click()
  await expect(page.getByTestId('hours-input')).toHaveValue('142.5')
  await page.getByTestId('hours-input').fill('144,0')
  await page.getByTestId('cond-mud').click()
  if (process.env.SCREENSHOTS) await page.screenshot({ path: 'tests/e2e/__screenshots__/log-ride.png' })
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByTestId('hours-value')).toHaveText('144.0 h')
  await expect(page.getByTestId('log-sheet')).toHaveCount(0)
  await expect(air).toBeVisible()
  await expect(air.getByTestId('item-state')).not.toHaveText(stateBefore!)
  expect(await index()).toBeLessThanOrEqual(before)

  // Typo: 1440 instead of 144.0 -> in-page prompt, Fix it keeps the sheet open
  await page.getByTestId('log-ride').click()
  await page.getByTestId('hours-input').fill('1440')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByTestId('jump-prompt')).toContainText("That's 1 296.0 h more than last time. Save anyway?")
  await page.getByRole('button', { name: 'Fix it' }).click()
  await expect(page.getByTestId('jump-prompt')).toHaveCount(0)

  // Lower than last
  await page.getByTestId('hours-input').fill('140')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByTestId('log-error')).toHaveText("Hours can't go down (last: 144.0 h)")
  await page.getByTestId('hours-input').fill('144')
  await page.getByTestId('km-input').fill('3000')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByTestId('log-error')).toHaveText("Km can't go down (last: 3 812 km)")

  // Confirmed big jump is saved
  await page.getByTestId('hours-input').fill('1440')
  await page.getByTestId('km-input').fill('3812')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await page.getByRole('button', { name: 'Save anyway' }).click()
  await expect(page.getByTestId('hours-value')).toHaveText('1440.0 h')

  // Replay: same clientId twice -> one reading
  const clientId = crypto.randomUUID()
  const body = { clientId, bikeId, hoursTenths: 14_500, km: 3900, condition: 'normal' }
  const a = await page.request.post('/api/readings', { data: body })
  const b = await page.request.post('/api/readings', { data: body })
  expect([a.status(), b.status()]).toEqual([200, 200])
  const db = sql()
  const [{ n }] = await db`select count(*)::int as n from meter_readings where client_id = ${clientId}`
  expect(n).toBe(1)
  await db.end()
})

test('a saved typo can be undone from the toast; Back closes the sheet, not the screen', async ({ page }) => {
  await loginAs(page)
  const name = `Undo Bike ${Date.now()}`
  const bikeId = await seedMockupBike(page.request, name)
  await page.goto('/')
  await page.getByTestId('bike-card').filter({ has: page.getByText(name, { exact: true }) }).click()
  await expect(page.getByTestId('hours-value')).toHaveText('142.5 h')

  // Back with the sheet open closes it and stays on the bike
  await page.getByTestId('log-ride').click()
  await expect(page.getByTestId('log-sheet')).toBeVisible()
  await page.goBack()
  await expect(page.getByTestId('log-sheet')).toHaveCount(0)
  await expect(page).toHaveURL(new RegExp(`/bikes/${bikeId}$`))

  // Confirmed typo, then Undo
  await page.getByTestId('log-ride').click()
  await page.getByTestId('hours-input').fill('1450')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await page.getByRole('button', { name: 'Save anyway' }).click()
  await expect(page.getByTestId('hours-value')).toHaveText('1450.0 h')
  await page.getByTestId('toast-action').click()
  await expect(page.getByTestId('toast')).toContainText('Reading undone')
  await expect(page.getByTestId('hours-value')).toHaveText('142.5 h')

  // The bike's first reading can't be undone
  const detail = (await (await page.request.get(`/api/bikes/${bikeId}`)).json()) as { latestReading: { id: string } }
  const res = await page.request.delete(`/api/bikes/${bikeId}/latest-reading`, { data: { readingId: detail.latestReading.id } })
  expect(res.status()).toBe(409)
})
