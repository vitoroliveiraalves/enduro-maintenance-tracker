import { expect, test } from '@playwright/test'
import { signUpFresh } from './helpers/login'
import { bikeBody } from './helpers/seed'

test('shelf: add, search, count down, offline count syncs once', async ({ page, context }) => {
  await signUpFresh(page)
  const bike = (await (await page.request.post('/api/bikes', { data: bikeBody('Shelf Bike', [{ name: 'Gearbox oil', everyHoursTenths: 150 }]) })).json()) as { id: string }

  await page.goto('/')
  await page.getByTestId('garage-shelf').click()
  await expect(page).toHaveURL(/\/shelf$/)
  await expect(page.getByTestId('shelf-empty')).toBeVisible()

  await page.getByTestId('add-part').click()
  await page.getByTestId('part-name').fill('Junta escape')
  await page.getByTestId('part-start').fill('2')
  await page.getByTestId('part-bike').selectOption(bike.id)
  await page.getByTestId('part-save').click()
  await expect(page.getByTestId('part-sheet')).toBeHidden()

  // A second part, typed with a decimal comma and a unit; "Any bike".
  await page.getByTestId('add-part').click()
  await page.getByTestId('part-name').fill('Óleo motor')
  await page.getByTestId('part-start').fill('1,5')
  await page.getByTestId('part-unit').fill('L')
  await page.getByTestId('part-save').click()
  await expect(page.getByTestId('part-row').filter({ hasText: 'Óleo motor' }).getByTestId('part-qty')).toHaveText('1.5 L')

  await page.getByTestId('shelf-search').fill('junta')
  await expect(page.getByTestId('part-row')).toHaveCount(1)
  const row = page.getByTestId('part-row').first()
  await expect(row).toContainText('Shelf Bike')
  await expect(row.getByTestId('part-qty')).toHaveText('2')
  await page.getByTestId('shelf-search').fill('OLEO')
  await expect(page.getByTestId('part-row')).toHaveCount(1)
  await page.getByTestId('shelf-search').fill('junta')

  await row.click()
  await page.getByTestId('part-minus').click()
  await expect(page.getByTestId('part-count')).toHaveText('1')
  await page.getByTestId('sheet-close').click()
  await expect(row.getByTestId('part-qty')).toHaveText('1')

  const count = async () => {
    const rows = (await (await page.request.get('/api/parts')).json()) as Array<{ name: string; qtyHundredths: number }>
    return rows.find((p) => p.name === 'Junta escape')!.qtyHundredths
  }
  // Offline: the count moves on screen and the change waits.
  await context.setOffline(true)
  await row.click()
  await page.getByTestId('part-minus').click()
  await expect(page.getByTestId('part-count')).toHaveText('0')
  await page.getByTestId('sheet-close').click()
  await expect(row.getByTestId('part-qty')).toHaveText('0')
  await expect(page.getByTestId('pending-badge')).toHaveText('1 change waiting')
  await context.setOffline(false)
  await expect(page.getByTestId('pending-badge')).toBeHidden()
  await expect(row.getByTestId('part-qty')).toHaveText('0')
  expect(await count()).toBe(0)
})

test('shelf: ?item= filter, low stock marker and delete', async ({ page }) => {
  await signUpFresh(page)
  const bike = (await (await page.request.post('/api/bikes', { data: bikeBody('Filter Bike', [{ name: 'Gearbox oil', everyHoursTenths: 150 }]) })).json()) as { id: string }
  const detail = (await (await page.request.get(`/api/bikes/${bike.id}`)).json()) as { items: Array<{ id: string }> }
  const itemId = detail.items[0]!.id
  const mk = (name: string, extra: object) => page.request.post('/api/parts', { data: { clientId: crypto.randomUUID(), name, qtyHundredths: 100, startClientId: crypto.randomUUID(), ...extra } })
  await mk('Oil filter', { bikeId: bike.id, itemIds: [itemId], minHundredths: 300 })
  await mk('Zip ties', {})

  await page.goto(`/shelf?item=${itemId}`)
  await expect(page.getByTestId('part-row')).toHaveCount(1)
  await expect(page.getByTestId('part-qty')).toHaveAttribute('data-low', 'true')
  await page.getByTestId('shelf-item-filter').getByRole('link').click()
  await expect(page.getByTestId('part-row')).toHaveCount(2)

  await page.getByTestId('part-row').filter({ hasText: 'Zip ties' }).click()
  await page.getByTestId('part-delete').click()
  await page.getByTestId('part-delete-yes').click()
  await expect(page.getByTestId('part-row')).toHaveCount(1)
})

test('part sheet: changing the bike drops links to the other bike\'s items', async ({ page }) => {
  await signUpFresh(page)
  const mk = async (name: string, item: string) => {
    const b = (await (await page.request.post('/api/bikes', { data: bikeBody(name, [{ name: item, everyHoursTenths: 150 }]) })).json()) as { id: string }
    const d = (await (await page.request.get(`/api/bikes/${b.id}`)).json()) as { items: Array<{ id: string }> }
    return { id: b.id, item: d.items[0]!.id }
  }
  const a = await mk('Bike A', 'A oil')
  const b = await mk('Bike B', 'B chain')
  const created = (await (await page.request.post('/api/parts', { data: { clientId: crypto.randomUUID(), name: 'Linked part', bikeId: a.id, itemIds: [a.item] } })).json()) as { id: string }

  await page.goto('/shelf')
  await page.getByTestId('part-row').click()
  await expect(page.getByTestId('part-item').filter({ hasText: 'A oil' })).toHaveAttribute('aria-pressed', 'true')
  await page.getByTestId('part-bike').selectOption(b.id)
  await expect(page.getByTestId('part-item')).toHaveText('B chain')
  await page.getByTestId('part-item').click()
  await page.getByTestId('part-save').click()
  await expect(page.getByTestId('part-sheet')).toBeHidden()
  const row = (await (await page.request.get(`/api/parts/${created.id}`)).json()) as { bikeId: string; itemIds: string[] }
  expect(row.bikeId).toBe(b.id)
  expect(row.itemIds).toEqual([b.item])
})

test('to buy: low part listed, manual entry added and ticked (kept after reload), count badge', async ({ page }) => {
  await signUpFresh(page)
  const r = await page.request.post('/api/parts', { data: { clientId: crypto.randomUUID(), name: 'Gasket', qtyHundredths: 100, minHundredths: 200, startClientId: crypto.randomUUID() } })
  expect(r.ok()).toBeTruthy()

  await page.goto('/shelf')
  await page.getByTestId('shelf-tab-buy').click()
  const auto = page.getByTestId('buy-auto')
  await expect(auto).toHaveCount(1)
  await expect(auto.getByTestId('buy-auto-name')).toHaveText('Gasket')
  await expect(auto.getByTestId('buy-auto-detail')).toHaveText('keep 2, have 1')
  await expect(page.getByTestId('buy-count')).toHaveText('1')

  await page.getByTestId('buy-add').click()
  await page.getByTestId('buy-text').fill('Chain lube')
  await page.getByTestId('buy-save').click()
  await expect(page.getByTestId('shopping-sheet')).toBeHidden()
  const manual = page.getByTestId('buy-manual')
  await expect(manual).toHaveCount(1)
  await expect(page.getByTestId('buy-count')).toHaveText('2')

  await manual.getByTestId('buy-tick').click()
  await expect(manual).toHaveAttribute('data-done', 'true')
  await expect(page.getByTestId('buy-count')).toHaveText('1')

  await page.reload()
  await page.getByTestId('shelf-tab-buy').click()
  await expect(page.getByTestId('buy-manual')).toHaveAttribute('data-done', 'true')
  await expect(page.getByTestId('buy-text-row')).toHaveCSS('text-decoration-line', 'line-through')

  // Tapping an automatic entry opens its part.
  await page.getByTestId('buy-auto').click()
  await expect(page.getByTestId('part-name')).toHaveValue('Gasket')
})

test('to buy: a manual entry added offline shows at once and syncs', async ({ page, context }) => {
  await signUpFresh(page)
  await page.goto('/shelf')
  await page.getByTestId('shelf-tab-buy').click()
  await expect(page.getByTestId('buy-empty')).toBeVisible()
  await context.setOffline(true)
  await page.getByTestId('buy-add').click()
  await page.getByTestId('buy-text').fill('Brake fluid')
  await page.getByTestId('buy-save').click()
  await expect(page.getByTestId('buy-manual')).toContainText('Brake fluid')
  await expect(page.getByTestId('pending-badge')).toHaveText('1 change waiting')
  await context.setOffline(false)
  await expect(page.getByTestId('pending-badge')).toBeHidden()
  const list = (await (await page.request.get('/api/shopping')).json()) as { manual: Array<{ text: string }> }
  expect(list.manual.map((m) => m.text)).toEqual(['Brake fluid'])
})

test('to buy: a linked manual entry is ticked when an invoice puts its part on the shelf', async ({ page }) => {
  await signUpFresh(page)
  const bike = await page.request.post('/api/bikes', { data: bikeBody('Invoice Bike', [{ name: 'Wheel bearings', everyHoursTenths: 500, everyMonths: 12 }]) })
  expect(bike.ok()).toBeTruthy()
  const part = (await (await page.request.post('/api/parts', { data: { clientId: crypto.randomUUID(), name: 'Rolamentos roda traseira' } })).json()) as { id: string }
  const entry = await page.request.post('/api/shopping', { data: { clientId: crypto.randomUUID(), text: 'Bearings for the rear wheel', partId: part.id } })
  expect(entry.ok()).toBeTruthy()

  await page.goto('/shelf')
  await page.getByTestId('shelf-tab-buy').click()
  await expect(page.getByTestId('buy-manual')).toHaveAttribute('data-done', 'false')
  await expect(page.getByTestId('buy-count')).toHaveText('1')

  const bikeId = ((await bike.json()) as { id: string }).id
  for (const [at, hoursTenths, km] of [['2026-10-06T10:00:00Z', 1305, 3500], ['2026-11-05T10:00:00Z', 1400, 3700]] as const) {
    expect((await page.request.post('/api/readings', { data: { clientId: crypto.randomUUID(), bikeId, at, hoursTenths, km } })).ok()).toBeTruthy()
  }
  // The mock reader reads three lines; the third is the part, put on the shelf under the existing part.
  await page.goto('/invoice')
  await page.getByTestId('file-input').setInputFiles('tests/e2e/fixtures/invoice-garage.jpg')
  await page.waitForURL(/\/invoice\/[0-9a-f-]{36}/, { timeout: 30_000 })
  const line = page.getByTestId('inv-line').nth(2)
  await line.waitFor({ timeout: 15_000 })
  await line.getByTestId('line-shelf').click()
  await line.getByTestId('line-shelf-pick').fill('ROLAM')
  await line.getByTestId('line-shelf-option').click()
  await page.getByTestId('confirm').click()
  await page.waitForURL(`/bikes/${bikeId}`, { timeout: 15_000 })

  await page.goto('/shelf')
  await page.getByTestId('shelf-tab-buy').click()
  await expect(page.getByTestId('buy-manual')).toHaveAttribute('data-done', 'true')
  await expect(page.getByTestId('buy-count')).toHaveCount(0)
})
