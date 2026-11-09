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
