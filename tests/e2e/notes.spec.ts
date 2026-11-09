import { expect, test } from '@playwright/test'
import { loginAs } from './helpers/login'
import { seedMockupBike } from './helpers/seed'

test('item notes: specs, steps and a photo; edit; delete after confirming', async ({ page }) => {
  await loginAs(page)
  const bikeId = await seedMockupBike(page.request, `Notes Bike ${Date.now()}`)
  const detail = (await (await page.request.get(`/api/bikes/${bikeId}`)).json()) as { items: Array<{ id: string; name: string }> }
  const chain = detail.items.find((i) => i.name === 'Chain & sprockets')!
  await page.goto(`/bikes/${bikeId}/items/${chain.id}`)

  // Empty state invites a note
  await page.getByTestId('note-add').click()
  const sheet = page.getByTestId('note-sheet')
  await expect(sheet).toBeVisible()
  await sheet.getByRole('button', { name: 'Torque specs' }).click()
  await expect(page.getByTestId('note-title')).toHaveValue('Torque specs')
  await expect(page.getByTestId('note-spec-row')).toHaveCount(2)
  await page.getByLabel('Spec 1 name').fill('Rear sprocket bolts')
  await page.getByLabel('Spec 1 value').fill('35 Nm')
  await page.getByLabel('Spec 2 name').fill('Axle nut')
  await page.getByLabel('Spec 2 value').fill('90 Nm')
  await page.getByTestId('note-body').fill('1. Loosen axle nut\n2. Set slack to 50 mm\n3. Blue Loctite on sprocket bolts')
  await page.getByTestId('note-photo-input').setInputFiles('tests/e2e/fixtures/invoice-garage.jpg')
  await expect(page.getByTestId('note-photo-new')).toHaveCount(1)
  await page.getByTestId('note-save').click()

  await expect(sheet).toHaveCount(0)
  await expect(page.getByTestId('toast')).toContainText('Torque specs saved')
  const card = page.getByTestId('note-card')
  await expect(card).toHaveCount(1)
  await expect(card.getByTestId('note-specs')).toContainText('Rear sprocket bolts')
  await expect(card.getByTestId('note-specs')).toContainText('90 Nm')
  await expect(card.getByTestId('note-body-text')).toContainText('Set slack to 50 mm')
  await expect(card.getByTestId('note-photo')).toHaveCount(1)
  // The photo loads (downscaled JPEG served back) and opens full screen
  await expect.poll(() => card.locator('img').evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0)).toBe(true)
  await card.getByTestId('note-photo').click()
  await expect(page.getByTestId('note-photo-viewer')).toBeVisible()
  await page.getByTestId('note-photo-viewer').click()
  await expect(page.getByTestId('note-photo-viewer')).toHaveCount(0)

  // Notes survive a reload
  await page.reload()
  await expect(page.getByTestId('note-card')).toHaveCount(1)

  // Edit: rename, drop the photo
  await page.getByTestId('note-edit').click()
  await page.getByTestId('note-title').fill('Chain torque & slack')
  await page.getByTestId('note-photo-remove').click()
  await page.getByTestId('note-save').click()
  await expect(page.getByTestId('note-card-title')).toHaveText('Chain torque & slack')
  await expect(page.getByTestId('note-card').getByTestId('note-photo')).toHaveCount(0)

  // A spec value without a name is caught in the form
  await page.getByTestId('note-edit').click()
  await page.getByTestId('note-add-spec').click()
  await page.getByLabel('Spec 3 value').fill('12 Nm')
  await page.getByTestId('note-save').click()
  await expect(page.getByTestId('note-error')).toContainText('needs a name')
  await page.getByRole('button', { name: 'Remove spec 3' }).click()

  // Delete asks first, in the page
  await page.getByTestId('note-delete').click()
  await expect(page.getByTestId('note-delete-confirm')).toContainText('Delete “Chain torque & slack” and its photos?')
  await page.getByTestId('note-delete-yes').click()
  await expect(page.getByTestId('note-card')).toHaveCount(0)
  await expect(page.getByTestId('note-add')).toBeVisible()
})

test("another rider can't read, edit or see the photos of my notes", async ({ page, request: req }) => {
  await loginAs(page)
  const bikeId = await seedMockupBike(page.request, `Private Notes ${Date.now()}`)
  const detail = (await (await page.request.get(`/api/bikes/${bikeId}`)).json()) as { items: Array<{ id: string }> }
  const itemId = detail.items[0]!.id
  const note = (await (await page.request.post(`/api/items/${itemId}/notes`, { data: { clientId: crypto.randomUUID(), title: 'Mine' } })).json()) as { id: string }
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4])
  const photo = (await (await page.request.post(`/api/notes/${note.id}/photos`, { multipart: { clientId: crypto.randomUUID(), file: { name: 'p.jpg', mimeType: 'image/jpeg', buffer: jpeg } } })).json()) as { id: string }
  expect(photo.id).toBeTruthy()
  const fake = await page.request.post(`/api/notes/${note.id}/photos`, { multipart: { clientId: crypto.randomUUID(), file: { name: 'p.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('<svg onload=alert(1)>') } } })
  expect(fake.status()).toBe(400)

  // `request` has its own cookie jar: a second rider.
  const email = `notes-${crypto.randomUUID()}@example.com`
  expect((await req.post('/api/auth/sign-up/email', { data: { email, password: 'enduro-pass-1', name: 'x' } })).ok()).toBeTruthy()
  expect((await req.get(`/api/items/${itemId}/notes`)).status()).toBe(404)
  expect((await req.patch(`/api/notes/${note.id}`, { data: { title: 'theirs' } })).status()).toBe(404)
  expect((await req.get(`/api/notes/${note.id}/photos/${photo.id}`)).status()).toBe(404)
  expect((await req.delete(`/api/notes/${note.id}`)).status()).toBe(404)
  expect((await page.request.get(`/api/notes/${note.id}/photos/${photo.id}`)).status()).toBe(200)
})
