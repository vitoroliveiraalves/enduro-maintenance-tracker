import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { E2E_ADMIN, loginAs, signUpFresh } from './helpers/login'
import { bikeBody } from './helpers/seed'

test('a rider has no admin screen', async ({ page }) => {
  await signUpFresh(page)
  expect((await page.request.get('/api/account')).ok()).toBeTruthy()
  expect(await (await page.request.get('/api/account')).json()).toEqual({ admin: false, aiEnabled: true })
  await page.goto('/settings')
  await expect(page.getByTestId('account-email')).not.toBeEmpty()
  await expect(page.getByTestId('admin-link')).toHaveCount(0)
  await page.goto('/admin')
  await page.waitForURL('/settings')
})

test('admin switches AI off for a rider: voice and invoice reading stop, the QR still reads', async ({ page, browser }) => {
  // The rider, in a context of their own.
  const riderCtx = await browser.newContext()
  const rider = await riderCtx.newPage()
  const { email } = await signUpFresh(rider)
  expect((await rider.request.post('/api/bikes', { data: bikeBody('Admin KTM', [{ name: 'Oil', everyHoursTenths: 150 }]) })).ok()).toBeTruthy()

  await loginAs(page, E2E_ADMIN)
  await page.goto('/settings')
  await page.getByTestId('admin-link').click()
  await page.waitForURL('/admin')
  const card = page.getByTestId('admin-rider').filter({ hasText: email })
  await expect(card.getByTestId('admin-count-bikes')).toContainText('1')
  await expect(card).toContainText('Last login')
  await expect(page.getByTestId('admin-rider').filter({ hasText: E2E_ADMIN.email })).toContainText('You')

  const toggle = card.getByTestId('admin-ai-toggle')
  await expect(toggle).toHaveAttribute('aria-checked', 'true')
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-checked', 'false')

  // Off for the rider, on the server.
  expect(await (await rider.request.get('/api/voice/status')).json()).toEqual({ available: false, off: true })
  const voice = await rider.request.post('/api/voice', { multipart: { transcript: 'Changed the oil' } })
  expect(voice.status()).toBe(403)
  const upload = await rider.request.post('/api/documents', {
    multipart: { clientId: crypto.randomUUID(), files: { name: 'invoice.jpg', mimeType: 'image/jpeg', buffer: readFileSync('tests/e2e/fixtures/invoice-garage.jpg') } },
  })
  expect(upload.ok()).toBeTruthy()
  const docId = ((await upload.json()) as { id: string }).id
  const read = await rider.request.post(`/api/documents/${docId}/read`)
  expect(((await read.json()) as { status: string }).status).toBe('manual')
  expect(((await (await rider.request.get(`/api/documents/${docId}`)).json()) as { canRead: boolean }).canRead).toBe(false)

  // Settings says why the mic is gone.
  await rider.goto('/settings')
  await expect(rider.getByTestId('voice-off-account')).toBeVisible()

  // Survives a reload; back on restores voice.
  await page.reload()
  await expect(card.getByTestId('admin-ai-toggle')).toHaveAttribute('aria-checked', 'false')
  await card.getByTestId('admin-ai-toggle').click()
  await expect(card.getByTestId('admin-ai-toggle')).toHaveAttribute('aria-checked', 'true')
  expect(await (await rider.request.get('/api/voice/status')).json()).toEqual({ available: true, off: false })
  await riderCtx.close()
})

test('admin API: bad input is a 400/404', async ({ page }) => {
  await loginAs(page, E2E_ADMIN)
  const req = page.request
  const users = (await (await req.get('/api/admin/users')).json()) as Array<{ id: string; email: string }>
  const me = users.find((u) => u.email === E2E_ADMIN.email)!
  for (const data of [{}, { aiEnabled: 'false' }, { aiEnabled: 0 }, { aiEnabled: null }]) {
    expect((await req.patch(`/api/admin/users/${me.id}`, { data })).status()).toBe(400)
  }
  expect((await req.patch('/api/admin/users/nope', { data: { aiEnabled: true } })).status()).toBe(404)
  expect((await req.patch(`/api/admin/users/${crypto.randomUUID()}`, { data: { aiEnabled: true } })).status()).toBe(404)
  expect((await req.patch(`/api/admin/users/${me.id}`, { data: { aiEnabled: true } })).ok()).toBeTruthy()
})
