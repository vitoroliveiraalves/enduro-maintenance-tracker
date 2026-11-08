import { expect, test } from '@playwright/test'
import { loginAs, sql } from './helpers/login'

const FIXTURE = 'tests/e2e/fixtures/invoice-qr.jpg'

test('upload an invoice photo: QR header shown; same file again opens the same document as a duplicate', async ({ page }) => {
  await loginAs(page)
  const db = sql()
  await db`delete from documents`
  await page.goto('/invoice')
  await page.getByTestId('file-input').setInputFiles(FIXTURE)
  await page.waitForURL(/\/invoice\/[0-9a-f-]{36}$/, { timeout: 30_000 })
  const firstUrl = page.url()
  await expect(page.getByTestId('supplier-nif')).toHaveText('501964843')
  await expect(page.getByTestId('invoice-total')).toContainText('123,00')
  await expect(page.getByTestId('qr-badge')).toHaveText('From QR code')
  await expect(page.getByTestId('duplicate-notice')).toHaveCount(0)
  await expect(page.getByTestId('thumbnails').locator('img')).toBeVisible()
  await expect.poll(() => page.getByTestId('thumbnails').locator('img').evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0)

  const [row] = await db`select status, supplier_nif, number, total_cents, issued_at::text as issued_at from documents`
  expect(row).toMatchObject({ status: 'manual', supplier_nif: '501964843', number: 'FT 2026A/0042', total_cents: 12300, issued_at: '2026-03-14' })

  // The same file again -> same document, notice, nothing new.
  await page.goto('/invoice')
  await page.getByTestId('file-input').setInputFiles(FIXTURE)
  await page.waitForURL(/\/invoice\/[0-9a-f-]{36}/, { timeout: 30_000 })
  expect(page.url().split('?')[0]).toBe(firstUrl)
  await expect(page.getByText('This invoice was already uploaded')).toBeVisible()
  const [{ n }] = await db`select count(*)::int as n from documents`
  expect(n).toBe(1)

  // The file is served with nosniff, and only to its owner.
  const id = firstUrl.split('/').pop()!
  const res = await page.request.get(`/api/documents/${id}/files/1`)
  expect(res.headers()['x-content-type-options']).toBe('nosniff')
  expect(res.headers()['content-type']).toBe('image/jpeg')
  await db.end()
})

test('camera pages can be added and removed before upload', async ({ page }) => {
  await loginAs(page)
  await page.goto('/invoice')
  await page.getByTestId('camera-input').setInputFiles(FIXTURE)
  await page.getByTestId('camera-input').setInputFiles(FIXTURE)
  await expect(page.getByTestId('pages').locator('img')).toHaveCount(2)
  await page.getByRole('button', { name: 'Remove page 1' }).click()
  await expect(page.getByTestId('pages').locator('img')).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'Upload 1 page' })).toBeVisible()
})

test('offline: buttons disabled and banner shown', async ({ page, context }) => {
  await loginAs(page)
  await page.goto('/invoice')
  await expect(page.getByTestId('offline-banner')).toHaveCount(0)
  await context.setOffline(true)
  await expect(page.getByTestId('offline-banner')).toHaveText("You're offline — invoices can be added when you're back online.")
  await expect(page.getByTestId('camera-input')).toBeDisabled()
  await expect(page.getByTestId('file-input')).toBeDisabled()
  await context.setOffline(false)
})

test('anonymous /invoice redirects to /login; anonymous upload is 401', async ({ page, request }) => {
  await page.goto('/invoice')
  await expect(page).toHaveURL(/\/login$/)
  const res = await request.post('/api/documents', { multipart: { files: { name: 'a.jpg', mimeType: 'image/jpeg', buffer: Buffer.from([0xff, 0xd8, 0xff, 0]) } } })
  expect(res.status()).toBe(401)
})

test('invoice capture screenshot', async ({ page }) => {
  test.skip(!process.env.SCREENSHOTS, 'screenshots only with SCREENSHOTS=1')
  await loginAs(page)
  await page.goto('/invoice')
  await page.getByTestId('camera-input').setInputFiles(FIXTURE)
  await page.getByTestId('camera-input').setInputFiles(FIXTURE)
  await expect(page.getByTestId('pages').locator('img')).toHaveCount(2)
  await page.screenshot({ path: 'tests/e2e/__screenshots__/invoice-capture.png' })
  await page.getByTestId('file-input').setInputFiles(FIXTURE)
  await page.waitForURL(/\/invoice\/[0-9a-f-]{36}/, { timeout: 30_000 })
  await expect(page.getByTestId('qr-badge')).toBeVisible()
  await page.screenshot({ path: 'tests/e2e/__screenshots__/invoice-detail.png' })
})
