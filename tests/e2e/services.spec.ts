import { expect, test } from '@playwright/test'
import { loginAs, signUpFresh } from './helpers/login'
import { bikeBody } from './helpers/seed'

test('mark done with a comma cost, standalone expense, history, delete', async ({ page }) => {
  await loginAs(page)
  await page.getByTestId('add-bike').click()
  await page.getByLabel('Name').fill('Svc Bike')
  await page.getByLabel('Make').fill('KTM')
  await page.getByLabel('Model').fill('300 EXC')
  await page.getByLabel('Current hours').fill('142,5')
  await page.getByLabel('Current km').fill('3812')
  await page.getByRole('button', { name: 'Next: maintenance items' }).click()
  const draft = page.getByTestId('item-draft').filter({ has: page.locator('input[aria-label="Item name"]') }).first()
  await draft.locator('summary').click()
  await page.getByLabel('Gearbox oil last done hours').fill('122')
  await page.getByRole('button', { name: 'Save bike' }).click()
  await expect(page).toHaveURL(/\/bikes\/[0-9a-f-]{36}$/)

  const gearbox = page.getByTestId('item-row').filter({ hasText: 'Gearbox oil' })
  await expect(gearbox.getByTestId('item-state')).toHaveText(/overdue/)

  // Mark done lives on the item page: sheet is an accessible dialog; Esc closes and focus returns to the button
  await gearbox.click()
  await expect(page).toHaveURL(/\/bikes\/[0-9a-f-]{36}\/items\/[0-9a-f-]{36}$/)
  const trigger = page.getByTestId('mark-done')
  await trigger.click()
  const dialog = page.getByRole('dialog', { name: 'Mark done: Gearbox oil' })
  await expect(dialog).toBeVisible()
  await expect(dialog).toHaveAttribute('aria-modal', 'true')
  await expect(page.getByTestId('md-date')).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(trigger).toBeFocused()

  await trigger.click()
  await expect(page.getByTestId('md-hours')).toHaveValue('142.5')
  await page.getByTestId('md-cost').fill('abc')
  await page.getByTestId('md-save').click()
  await expect(page.getByTestId('md-error')).toContainText('Enter the cost')
  await page.getByTestId('md-cost').fill('24,90')
  await expect(page.getByTestId('md-error')).toHaveCount(0)
  if (process.env.SCREENSHOTS) await page.screenshot({ path: 'tests/e2e/__screenshots__/mark-done.png' })
  await page.getByTestId('md-save').click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByTestId('item-state')).not.toHaveText(/overdue/)
  await expect(page.getByTestId('service-entry')).toHaveCount(2)
  await expect(page.getByTestId('service-entry').first()).toContainText('24,90 €')
  await page.getByTestId('back-to-bike').click()
  await expect(gearbox.getByTestId('item-state')).not.toHaveText(/overdue/)

  // Standalone expense from History
  await page.getByTestId('tab-history').click()
  const svcRow = page.getByTestId('history-service').filter({ hasText: 'Svc Bike' }).filter({ hasText: '24,90 €' })
  await expect(svcRow).toContainText('Gearbox oil')
  await expect(svcRow).toContainText('DIY')
  await expect(svcRow.getByTestId('history-amount')).toHaveText('24,90 €')
  await page.getByTestId('add-expense').click()
  await page.getByTestId('ex-amount').fill('41,60')
  await page.getByTestId('ex-description').fill('Fuel for the e2e')
  await page.getByTestId('ex-save').click()
  await expect(page.getByTestId('expense-sheet')).toHaveCount(0)
  const fuel = page.getByTestId('history-expense').filter({ hasText: 'Fuel for the e2e' })
  await expect(fuel).toContainText('Fuel')
  await expect(fuel.getByTestId('history-amount')).toHaveText('41,60 €')
  if (process.env.SCREENSHOTS) await page.screenshot({ path: 'tests/e2e/__screenshots__/history.png' })

  // Delete the service with an in-page confirmation: status falls back to overdue
  await svcRow.getByTestId('delete-service').click()
  await svcRow.getByTestId('confirm-delete').click()
  await expect(svcRow).toHaveCount(0)
  await page.getByTestId('tab-garage').click()
  await page.getByTestId('bike-card').filter({ hasText: 'Svc Bike' }).first().click()
  await expect(page.getByTestId('item-row').filter({ hasText: 'Gearbox oil' }).getByTestId('item-state')).toHaveText(/overdue/)
})

test('parts used in mark done: stock marks, shelf counts, history line, use anyway', async ({ page }) => {
  await signUpFresh(page)
  const bike = (await (await page.request.post('/api/bikes', {
    data: bikeBody('Parts Bike', [{ name: 'Engine oil', everyHoursTenths: 200, lastDone: { at: new Date().toISOString().slice(0, 10), hoursTenths: 1250, km: 3000 } }]),
  })).json()) as { id: string }
  const detail = (await (await page.request.get(`/api/bikes/${bike.id}`)).json()) as { items: Array<{ id: string }> }
  const itemId = detail.items[0]!.id
  const mk = async (name: string, qty: number, extra: object) => {
    const r = await page.request.post('/api/parts', { data: { clientId: crypto.randomUUID(), name, qtyHundredths: qty, startClientId: crypto.randomUUID(), bikeId: bike.id, ...extra } })
    expect(r.ok()).toBeTruthy()
  }
  await mk('Oil filter', 100, { itemIds: [itemId] })
  await mk('Motorex 10W-50', 150, { unit: 'L' })
  const counts = async () => {
    const rows = (await (await page.request.get('/api/parts')).json()) as Array<{ name: string; qtyHundredths: number }>
    return Object.fromEntries(rows.map((p) => [p.name, p.qtyHundredths]))
  }

  await page.goto(`/bikes/${bike.id}`)
  const row = page.getByTestId('item-row').filter({ hasText: 'Engine oil' })
  await expect(row.getByTestId('item-state')).toHaveText('2.5h left')
  await expect(row.getByTestId('item-stock')).toHaveText('✓ in stock')
  await row.getByTestId('item-stock').click()
  await expect(page).toHaveURL(new RegExp(`/shelf\\?item=${itemId}$`))
  await expect(page.getByTestId('part-row')).toHaveCount(1)
  await page.goBack()

  await row.click()
  await page.getByTestId('mark-done').click()
  const parts = page.getByTestId('parts-used')
  await expect(parts.getByTestId('parts-used-row')).toHaveCount(1)
  await expect(parts.getByTestId('parts-used-check')).toBeChecked()
  await expect(parts.getByTestId('parts-used-qty')).toHaveValue('1')
  await page.getByTestId('parts-add-open').click()
  await page.getByTestId('parts-add').fill('motorex')
  await page.getByTestId('parts-add-option').click()
  await expect(parts.getByTestId('parts-used-row')).toHaveCount(2)
  await parts.getByTestId('parts-used-qty').nth(1).fill('0,5')
  await page.getByTestId('md-save').click()
  await expect(page.getByTestId('mark-done-sheet')).toHaveCount(0)
  await expect(page.getByTestId('service-parts').first()).toHaveText('Parts: 0.5 L Motorex 10W-50, Oil filter')
  expect(await counts()).toEqual({ 'Oil filter': 0, 'Motorex 10W-50': 100 })

  // Back to "soon" after a ride: the filter is gone, so the row says so.
  const reading = await page.request.post('/api/readings', { data: { clientId: crypto.randomUUID(), bikeId: bike.id, hoursTenths: 1600, km: 3900 } })
  expect(reading.ok()).toBeTruthy()
  await page.goto(`/bikes/${bike.id}`)
  await expect(row.getByTestId('item-stock')).toHaveText('✗ no spare')

  // Using more than the shelf has needs "Use anyway".
  await row.click()
  await page.getByTestId('mark-done').click()
  await expect(parts.getByTestId('parts-used-check')).not.toBeChecked()
  await parts.getByTestId('parts-used-check').check()
  await expect(page.getByTestId('parts-short')).toBeVisible()
  await page.getByTestId('md-save').click()
  await expect(page.getByTestId('md-error')).toContainText('Use anyway')
  await page.getByTestId('parts-use-anyway').click()
  await page.getByTestId('md-save').click()
  await expect(page.getByTestId('mark-done-sheet')).toHaveCount(0)
  expect((await counts())['Oil filter']).toBe(-100)
})
