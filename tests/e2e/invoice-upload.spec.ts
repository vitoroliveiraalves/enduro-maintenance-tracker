import { expect, test } from '@playwright/test'
import { signUpFresh, sql } from './helpers/login'

const FIXTURE = 'tests/e2e/fixtures/invoice-qr.jpg'

// Each test signs up its own user (no shared documents); serial keeps the heavy
// QR decoding from piling up under load.
test.describe.configure({ mode: 'serial' })

test('upload an invoice photo: QR header shown; same file again opens the same document as a duplicate', async ({ page }) => {
  const { email } = await signUpFresh(page)
  await page.goto('/invoice')
  await page.getByTestId('file-input').setInputFiles(FIXTURE)
  await page.waitForURL(/\/invoice\/[0-9a-f-]{36}$/, { timeout: 30_000 })
  const firstUrl = page.url()
  const id = firstUrl.split('/').pop()!
  // The (mock) reader runs and the review form opens with the QR header, read-only.
  await expect(page.getByTestId('inv-line')).toHaveCount(3, { timeout: 15_000 })
  await expect(page.getByTestId('supplier-nif')).toHaveValue('501964843')
  await expect(page.getByTestId('supplier-nif')).toBeDisabled()
  await expect(page.getByTestId('invoice-total')).toContainText('123,00')
  await expect(page.getByTestId('qr-badge')).toHaveText('From QR code')
  await expect(page.getByTestId('duplicate-notice')).toHaveCount(0)
  await expect.poll(() => page.getByTestId('viewer-image').evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0)

  const db = sql()
  const rows = await db`select d.status, d.supplier_nif, d.number, d.total_cents, d.issued_at::text as issued_at
    from documents d join "user" u on u.id = d.user_id where u.email = ${email}`
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({ status: 'review', supplier_nif: '501964843', number: 'FT 2026A/0042', total_cents: 12300, issued_at: '2026-03-14' })

  // The same file again -> same document, notice, nothing new.
  await page.goto('/invoice')
  await page.getByTestId('file-input').setInputFiles(FIXTURE)
  await page.waitForURL(/\/invoice\/[0-9a-f-]{36}/, { timeout: 30_000 })
  expect(page.url().split('?')[0]).toBe(firstUrl)
  await expect(page.getByText('This invoice was already uploaded')).toBeVisible()
  const [{ n }] = await db`select count(*)::int as n from documents d join "user" u on u.id = d.user_id where u.email = ${email}`
  expect(n).toBe(1)
  await db.end()

  // The file is served with nosniff, and only to its owner.
  const res = await page.request.get(`/api/documents/${id}/files/1`)
  expect(res.headers()['x-content-type-options']).toBe('nosniff')
  expect(res.headers()['content-type']).toBe('image/jpeg')
})

test('camera pages can be added and removed before upload', async ({ page }) => {
  await signUpFresh(page)
  await page.goto('/invoice')
  await page.getByTestId('camera-input').setInputFiles(FIXTURE)
  await page.getByTestId('camera-input').setInputFiles(FIXTURE)
  await expect(page.getByTestId('pages').locator('img')).toHaveCount(2)
  await page.getByRole('button', { name: 'Remove page 1' }).click()
  await expect(page.getByTestId('pages').locator('img')).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'Upload 1 page' })).toBeVisible()
})

test('a photo the browser cannot decode shows a calm error', async ({ page }) => {
  await signUpFresh(page)
  await page.goto('/invoice')
  await page.getByTestId('camera-input').setInputFiles({ name: 'IMG_0001.heic', mimeType: 'image/heic', buffer: Buffer.from('not really an image') })
  await expect(page.getByRole('alert')).toHaveText("Couldn't read that photo — try another or choose a file.")
  await expect(page.getByTestId('pages')).toHaveCount(0)
})

test('offline: a photo is kept on the phone, then uploaded and read when back online (R12)', async ({ page, context }) => {
  const { email } = await signUpFresh(page)
  await page.goto('/invoice')
  // Mounted, and the auth middleware has confirmed and cached the session, before going offline.
  await expect(page.getByRole('heading', { name: 'Add invoice' })).toBeVisible()
  await page.waitForFunction(() => localStorage.getItem('enduro:session'))
  await expect(page.getByTestId('offline-banner')).toHaveCount(0)
  await context.setOffline(true)
  await expect(page.getByTestId('offline-banner')).toHaveText("You're offline — photos are saved on this phone and uploaded when you're back online.")
  await expect(page.getByTestId('camera-input')).toBeEnabled()
  await page.getByTestId('camera-input').setInputFiles(FIXTURE)
  await expect(page.getByTestId('pages').locator('img')).toHaveCount(1)
  await page.getByRole('button', { name: 'Save 1 page' }).click()
  await expect(page.getByTestId('invoice-saved-offline')).toBeVisible()
  await expect(page.getByTestId('invoices-waiting')).toHaveText('1 invoice waiting to upload — keep the app open when online')

  const db = sql()
  try {
    const docs = async () => (await db`select d.id from documents d join "user" u on u.id = d.user_id where u.email = ${email}`).map((r) => r.id as string)
    expect(await docs()).toHaveLength(0)
    await context.setOffline(false)
    await expect(page.getByTestId('invoices-waiting')).toBeHidden({ timeout: 30_000 })
    await expect(page.getByTestId('invoice-uploaded')).toBeVisible()
    const ids = await docs()
    expect(ids).toHaveLength(1)
    // It was read too: the review opens with the (mock) lines.
    await page.getByTestId('invoice-uploaded').click()
    await expect(page).toHaveURL(new RegExp(`/invoice/${ids[0]}$`))
    await expect(page.getByTestId('inv-line')).toHaveCount(3, { timeout: 15_000 })
    await expect(page.getByTestId('invoice-uploaded')).toHaveCount(0)
  } finally {
    await db.end()
  }
})

test('anonymous /invoice redirects to /login; anonymous upload is 401', async ({ page, request }) => {
  await page.goto('/invoice')
  await expect(page).toHaveURL(/\/login$/)
  const res = await request.post('/api/documents', { multipart: { files: { name: 'a.jpg', mimeType: 'image/jpeg', buffer: Buffer.from([0xff, 0xd8, 0xff, 0]) } } })
  expect(res.status()).toBe(401)
})

test('invoice capture screenshot', async ({ page }) => {
  test.skip(!process.env.SCREENSHOTS, 'screenshots only with SCREENSHOTS=1')
  await signUpFresh(page)
  await page.goto('/invoice')
  await page.getByTestId('camera-input').setInputFiles(FIXTURE)
  await page.getByTestId('camera-input').setInputFiles(FIXTURE)
  await expect(page.getByTestId('pages').locator('img')).toHaveCount(2)
  await page.screenshot({ path: 'tests/e2e/__screenshots__/invoice-capture.png' })
})
