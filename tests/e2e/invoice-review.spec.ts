import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { signUpFresh, sql } from './helpers/login'
import { bikeBody } from './helpers/seed'

// The server runs the mock reader (NUXT_INVOICE_READER=mock): every upload reads as
// "Pneu … 129,00 (tyre) · Mão de obra 30,00 (labour) · Rolamentos roda traseira 56,40 (part)",
// except a file carrying MOCK-FAIL, which fails like a blurred photo would.
const GARAGE = 'tests/e2e/fixtures/invoice-garage.jpg' // QR total 215,40 = the 3 lines
const QR_123 = 'tests/e2e/fixtures/invoice-qr.jpg' // QR total 123,00
const RECEIPT = 'tests/e2e/fixtures/receipt-rc.jpg' // a receipt QR, not an invoice
const FAIL_PDF = 'tests/e2e/fixtures/invoice-mock-fail.pdf'
const MANUAL = "Couldn't read this invoice automatically. The photos are saved — add the lines yourself."

test.describe.configure({ mode: 'serial' })

const day = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString().slice(0, 10)

async function freshRiderWithBike(page: Page) {
  const user = await signUpFresh(page)
  const res = await page.request.post('/api/bikes', {
    data: bikeBody('Invoice Bike', [
      { name: 'Gearbox oil', everyHoursTenths: 150, lastDone: { at: day(40), hoursTenths: 1300, km: 3500 } },
      { name: 'Wheel bearings', everyHoursTenths: 500, everyMonths: 12 },
      { name: 'Chain & sprockets', everyKm: 1500 },
    ]),
  })
  expect(res.ok()).toBeTruthy()
  const bikeId = ((await res.json()) as { id: string }).id
  // Readings around the garage invoice (2 Nov): one before it, one after it, then today's 142.5 h.
  for (const [at, hoursTenths, km] of [['2026-10-06T10:00:00Z', 1305, 3500], ['2026-11-05T10:00:00Z', 1400, 3700]] as const) {
    const r = await page.request.post('/api/readings', { data: { clientId: crypto.randomUUID(), bikeId, at, hoursTenths, km } })
    expect(r.ok()).toBeTruthy()
  }
  return { ...user, bikeId }
}

async function upload(page: Page, file: string) {
  await page.goto('/invoice')
  await expect(page.getByRole('heading', { name: 'Add invoice' })).toBeVisible()
  await page.getByTestId('file-input').setInputFiles(file)
  await page.waitForURL(/\/invoice\/[0-9a-f-]{36}/, { timeout: 30_000 })
  return new URL(page.url()).pathname.split('/').pop()!
}

test('read → review 3 lines with suggestions → confirm → bike shows Wheel bearings green · garage, 🧾 opens the invoice', async ({ page }) => {
  const { bikeId, email } = await freshRiderWithBike(page)
  const docId = await upload(page, GARAGE)

  const lines = page.getByTestId('inv-line')
  await expect(lines).toHaveCount(3, { timeout: 15_000 })
  await expect(lines.nth(0).getByTestId('line-desc')).toHaveValue('Pneu Michelin Enduro Medium 140/80-18')
  await expect(lines.nth(0).getByTestId('line-amount')).toHaveValue('129,00')
  await expect(lines.nth(0).getByTestId('line-category').locator('option:checked')).toHaveText('Tyres & mousse')
  await expect(lines.nth(1).getByTestId('line-category').locator('option:checked')).toHaveText('Labour')
  await expect(lines.nth(2).getByTestId('line-category').locator('option:checked')).toHaveText('Maintenance')
  await expect(lines.nth(0).getByTestId('item-chip')).toHaveCount(0)
  await expect(lines.nth(1).getByTestId('item-chip')).toHaveCount(0)
  await expect(lines.nth(2).getByTestId('item-chip')).toHaveText(['Wheel bearings ×'])

  // QR header: read-only with the badge
  await expect(page.getByTestId('qr-badge')).toBeVisible()
  await expect(page.getByTestId('supplier-nif')).toHaveValue('509876543')
  await expect(page.getByTestId('supplier-nif')).toBeDisabled()
  await expect(page.getByTestId('inv-date')).toHaveValue('2026-11-02')
  await expect(page.getByTestId('invoice-total')).toHaveText('215,40 €')
  // Bike picked; meters from the last reading on or before the invoice date (6 Oct), not the later 5 Nov one
  await expect(page.getByTestId('inv-bike').locator('option:checked')).toHaveText('Invoice Bike')
  await expect(page.getByTestId('inv-hours')).toHaveValue('130.5')
  await expect(page.getByTestId('inv-km')).toHaveValue('3500')
  await expect(page.getByTestId('meters-hint')).toHaveText('From your last reading before 2 Nov 2026')

  // Totals check follows the lines
  await expect(page.getByTestId('totals-check')).toHaveText('Lines match the invoice total ✓')
  await lines.nth(1).getByTestId('line-amount').fill('17,70')
  await expect(page.getByTestId('totals-check')).toHaveText('Lines are 12,30 € short of the total')
  await lines.nth(1).getByTestId('line-amount').fill('30,00')
  await expect(page.getByTestId('totals-check')).toHaveText('Lines match the invoice total ✓')

  await page.getByTestId('inv-garage').fill('Moto Garage Braga')
  await page.getByTestId('confirm').click()
  await page.waitForURL(`/bikes/${bikeId}`)

  const row = page.getByTestId('item-row').filter({ hasText: 'Wheel bearings' })
  await expect(row.getByRole('progressbar').locator('i')).toHaveClass(/bg-ok/)
  await expect(row.getByTestId('item-subline')).toHaveText(/· garage$/)

  await row.click()
  const link = page.getByTestId('service-invoice')
  await expect(link).toHaveAttribute('href', `/invoice/${docId}`)
  await expect(page.getByTestId('service-entry').first()).toContainText('Garage · Moto Garage Braga')
  await link.click()
  await expect(page.getByTestId('saved-lines')).toContainText('Saved ✓')
  await expect(page.getByTestId('saved-lines').locator('li')).toHaveCount(3)
  await expect.poll(() => page.getByTestId('viewer-image').evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0)
  await expect(page.getByTestId('confirm')).toHaveCount(0)
  await expect(page.getByTestId('discard')).toHaveCount(0)

  const db = sql()
  const exps = await db`select e.document_line, e.amount_cents, c.kind from expenses e
    join categories c on c.id = e.category_id join "user" u on u.id = e.user_id
    where u.email = ${email} and e.document_id = ${docId} order by e.document_line`
  await db.end()
  expect(exps.map((e) => [e.document_line, e.amount_cents, e.kind])).toEqual([
    [1, 12900, 'tyres'],
    [2, 3000, 'labour'],
    [3, 5640, 'maintenance'],
  ])
  // A saved invoice can't be confirmed again
  const again = await page.request.post(`/api/documents/${docId}/confirm`, { data: { bikeId, at: '2026-11-02', lines: [] } })
  expect(again.status()).toBe(409)
})

test('line 3 to the shelf → no service, part on the shelf with 1; a second invoice adds to it via the picker', async ({ page }) => {
  const { bikeId } = await freshRiderWithBike(page)
  await upload(page, GARAGE)
  const lines = page.getByTestId('inv-line')
  await expect(lines).toHaveCount(3, { timeout: 15_000 })
  await lines.nth(2).getByTestId('line-shelf').click()
  await expect(lines.nth(2).getByTestId('line-shelf-name')).toHaveValue('Rolamentos roda traseira')
  await expect(lines.nth(2).getByTestId('line-shelf-qty')).toHaveValue('1')
  await expect(lines.nth(2).getByTestId('line-shelf-unit')).toHaveValue('pcs')
  await expect(lines.nth(2).getByTestId('item-chip')).toHaveCount(0)
  await expect(lines.nth(2).getByTestId('link-items')).toHaveCount(0)
  await page.getByTestId('confirm').click()
  await page.waitForURL(`/bikes/${bikeId}`)

  const parts = (await (await page.request.get('/api/parts')).json()) as Array<{ name: string; qtyHundredths: number }>
  expect(parts.map((p) => [p.name, p.qtyHundredths])).toEqual([['Rolamentos roda traseira', 100]])
  const svcs = (await (await page.request.get('/api/services')).json()) as Array<{ documentId: string | null }>
  expect(svcs.filter((x) => x.documentId)).toHaveLength(0) // only the bike's seeded history

  // Second invoice: pick the existing part, 1,5 units
  await upload(page, QR_123)
  const first = page.getByTestId('inv-line').first()
  await expect(first).toBeVisible({ timeout: 15_000 })
  await first.getByTestId('line-shelf').click()
  await first.getByTestId('line-shelf-pick').fill('ROLAM')
  await first.getByTestId('line-shelf-option').click()
  await first.getByTestId('line-shelf-qty').fill('1,5')
  await page.getByTestId('confirm').click()
  await page.getByTestId('force-save').click() // the mock reads 3 lines against a 123,00 QR total
  await page.waitForURL(`/bikes/${bikeId}`, { timeout: 15_000 })
  const after = (await (await page.request.get('/api/parts')).json()) as Array<{ qtyHundredths: number }>
  expect(after.map((p) => p.qtyHundredths)).toEqual([250])
})

test('reading fails → manual notice; one line typed by hand; confirm works', async ({ page }) => {
  const { bikeId } = await freshRiderWithBike(page)
  const docId = await upload(page, FAIL_PDF)

  await expect(page.getByTestId('manual-notice')).toContainText(MANUAL, { timeout: 15_000 })
  await expect(page.getByTestId('manual-reason')).toHaveText('The photo looks blurred or cut off.')
  await expect(page.getByTestId('retry-read')).toBeVisible()
  await expect(page.getByTestId('no-lines')).toBeVisible()
  await expect(page.getByTestId('inv-line')).toHaveCount(0)
  await expect(page.getByTestId('viewer-pdf')).toBeVisible()
  // The PDF is served sandboxed
  const pdf = await page.request.get(`/api/documents/${docId}/files/1`)
  expect(pdf.headers()['content-security-policy']).toBe('sandbox')

  await page.getByTestId('add-line').click()
  const line = page.getByTestId('inv-line')
  await line.getByTestId('line-desc').fill('Revisão caixa')
  await line.getByTestId('line-amount').fill('45,5')
  await line.getByTestId('item-option').filter({ hasText: 'Gearbox oil' }).click()
  await expect(line.getByTestId('item-chip')).toHaveText(['Gearbox oil ×'])
  await expect(page.getByTestId('totals-check')).toHaveCount(0) // no total to check against
  await page.getByTestId('confirm').click()
  await page.waitForURL(`/bikes/${bikeId}`)
  await expect(page.getByTestId('item-row').filter({ hasText: 'Gearbox oil' }).getByTestId('item-subline')).toHaveText(/· garage$/)
})

test('a >80 char description sent to the shelf is cut to the 80-char part name limit', async ({ page }) => {
  const { bikeId } = await freshRiderWithBike(page)
  await upload(page, FAIL_PDF)
  await expect(page.getByTestId('manual-notice')).toBeVisible({ timeout: 15_000 })
  await page.getByTestId('add-line').click()
  const line = page.getByTestId('inv-line')
  await line.getByTestId('line-desc').fill('Q'.repeat(120))
  await line.getByTestId('line-amount').fill('10')
  await line.getByTestId('line-shelf').click()
  await expect(line.getByTestId('line-shelf-name')).toHaveValue('Q'.repeat(80))
  await page.getByTestId('confirm').click()
  await page.waitForURL(`/bikes/${bikeId}`, { timeout: 15_000 })
  const parts = (await (await page.request.get('/api/parts')).json()) as Array<{ name: string }>
  expect(parts.map((p) => p.name)).toEqual(['Q'.repeat(80)])
})

test('totals off by more than the tolerance → asked to save anyway', async ({ page }) => {
  const { bikeId } = await freshRiderWithBike(page)
  await upload(page, QR_123)
  await expect(page.getByTestId('inv-line')).toHaveCount(3, { timeout: 15_000 })
  await expect(page.getByTestId('totals-check')).toHaveText('Lines are 92,40 € over the total')
  await page.getByTestId('confirm').click()
  await expect(page.getByTestId('totals-mismatch')).toContainText('92,40 € over the invoice total')
  await expect(page).toHaveURL(/\/invoice\//)
  await page.getByTestId('force-save').click()
  await page.waitForURL(`/bikes/${bikeId}`)
})

test('a receipt QR (not an invoice) does not block the upload: photo kept, notice shown', async ({ page }) => {
  await freshRiderWithBike(page)
  await upload(page, RECEIPT)
  await expect(page.getByTestId('qr-notice')).toContainText('This QR code is not an invoice (document type RC).')
  await expect(page.getByTestId('qr-badge')).toHaveCount(0)
  await expect(page.getByTestId('inv-line')).toHaveCount(3, { timeout: 15_000 })
  await expect.poll(() => page.getByTestId('viewer-image').evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0)
})

test('discard asks in the page, then deletes the document and its photos', async ({ page }) => {
  await freshRiderWithBike(page)
  const docId = await upload(page, GARAGE)
  await expect(page.getByTestId('inv-line')).toHaveCount(3, { timeout: 15_000 })
  await page.getByTestId('discard').click()
  await expect(page.getByTestId('discard-ask')).toContainText('Discard this invoice and its photos?')
  await page.getByTestId('discard-confirm').click()
  await page.waitForURL('/invoice')
  expect((await page.request.get(`/api/documents/${docId}`)).status()).toBe(404)
  expect((await page.request.get(`/api/documents/${docId}/files/1`)).status()).toBe(404)
})

test("user B gets 404 on user A's document and its files", async ({ page, browser }) => {
  await freshRiderWithBike(page)
  const docId = await upload(page, GARAGE)
  expect((await page.request.get(`/api/documents/${docId}/files/1`)).status()).toBe(200)

  const other = await browser.newContext()
  const pageB = await other.newPage()
  await signUpFresh(pageB)
  expect((await pageB.request.get(`/api/documents/${docId}`)).status()).toBe(404)
  expect((await pageB.request.get(`/api/documents/${docId}/files/1`)).status()).toBe(404)
  expect((await pageB.request.post(`/api/documents/${docId}/read`, { data: {} })).status()).toBe(404)
  expect((await pageB.request.delete(`/api/documents/${docId}/discard`)).status()).toBe(404)
  await other.close()
})
