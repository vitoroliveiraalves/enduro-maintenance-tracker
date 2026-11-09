import { expect, test } from '@playwright/test'
import { signUpFresh } from './helpers/login'
import { bikeBody } from './helpers/seed'

// Mock reader (see invoice-review.spec.ts): tyre 129,00 · labour (read wrong) · wheel bearings 56,40; QR total 215,40.
const GARAGE = 'tests/e2e/fixtures/invoice-garage.jpg'

test('saved invoices: listed, opened from History, moved to another bike with a fixed line, then deleted', async ({ page }) => {
  await signUpFresh(page)
  for (const [name, items] of [['Invoice KTM', [{ name: 'Wheel bearings', everyHoursTenths: 500 }]], ['Second bike', []]] as const) {
    const r = await page.request.post('/api/bikes', { data: bikeBody(name, [...items]) })
    expect(r.ok()).toBeTruthy()
  }

  await page.goto('/invoice')
  await expect(page.getByTestId('invoice-list-empty')).toBeVisible()
  await page.getByTestId('file-input').setInputFiles(GARAGE)
  await page.waitForURL(/\/invoice\/[0-9a-f-]{36}/, { timeout: 30_000 })
  const docId = new URL(page.url()).pathname.split('/').pop()!
  const lines = page.getByTestId('inv-line')
  await expect(lines).toHaveCount(3, { timeout: 15_000 })
  await page.getByTestId('inv-bike').selectOption({ label: 'Invoice KTM' })
  await lines.nth(1).getByTestId('line-amount').fill('30,00')
  await page.getByTestId('inv-garage').fill('Moto Braga')
  await page.getByTestId('confirm').click()
  await page.waitForURL(/\/bikes\//)

  // Listed on the Invoice tab
  await page.goto('/invoice')
  const row = page.getByTestId('invoice-row')
  await expect(row).toHaveCount(1)
  await expect(row).toContainText('Moto Braga')
  await expect(row.getByTestId('invoice-row-note')).toContainText('Invoice KTM')
  await expect(row.getByTestId('invoice-row-total')).toHaveText('215,40 €')

  // Opened from History's 🧾
  await page.goto('/history')
  await page.getByTestId('history-invoice').click()
  await page.waitForURL(`/invoice/${docId}`)
  await expect(page.getByTestId('saved-bike')).toContainText('Invoice KTM')

  // Change: another bike, the tyre was read wrong
  await page.getByTestId('change').click()
  await expect(lines).toHaveCount(3)
  await expect(lines.nth(0).getByTestId('line-amount')).toHaveValue('129,00')
  await expect(lines.nth(2).getByTestId('item-chip')).toHaveText(['Wheel bearings ×'])
  await page.getByTestId('change-cancel').click()
  await expect(page.getByTestId('saved-lines')).toBeVisible()
  await page.getByTestId('change').click()
  await page.getByTestId('inv-bike').selectOption({ label: 'Second bike' })
  await lines.nth(0).getByTestId('line-amount').fill('120,00')
  await page.getByTestId('confirm').click()
  await page.getByTestId('force-save').click() // 9,00 short of the QR total now
  await expect(page.getByTestId('saved-lines')).toContainText('120,00 €')
  await expect(page.getByTestId('saved-bike')).toContainText('Second bike')

  await page.goto('/invoice')
  await expect(row.getByTestId('invoice-row-note')).toContainText('Second bike')
  await expect(row.getByTestId('invoice-row-total')).toHaveText('206,40 €')

  // Delete with everything it made
  await row.click()
  await page.getByTestId('delete').click()
  await expect(page.getByTestId('delete-ask')).toContainText('its 3 costs (206,40 €)')
  await page.getByTestId('delete-confirm').click()
  await page.waitForURL('/invoice')
  await expect(page.getByTestId('invoice-list-empty')).toBeVisible()
  await page.goto('/history')
  await expect(page.getByTestId('history-expense')).toHaveCount(0)
  await expect(page.getByTestId('history-service')).toHaveCount(0)
})
