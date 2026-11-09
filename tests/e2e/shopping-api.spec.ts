import { expect, test } from '@playwright/test'
import type { APIRequestContext } from '@playwright/test'
import { bikeBody } from './helpers/seed'

const uuid = () => crypto.randomUUID()
const signUp = async (request: APIRequestContext, tag: string) => {
  const res = await request.post('/api/auth/sign-up/email', { data: { email: `${tag}-${uuid()}@example.com`, password: 'enduro-pass-1', name: 'rider' } })
  expect(res.ok()).toBeTruthy()
}
type Manual = { id: string; text: string; bikeId: string | null; bikeName: string | null; partId: string | null; doneAt: string | null }
type Auto = { key: string; partId: string; reason: string; detail: string; bikeName: string | null }
type List = { auto: Auto[]; manual: Manual[] }

test('shopping API: computed + manual entries', async ({ request }) => {
  await signUp(request, 'shop')
  // Current meter is past a 1 h interval from 0 h, so the item is overdue.
  const bike = (await (await request.post('/api/bikes', { data: bikeBody('Shop A', [{ name: 'Oil', everyHoursTenths: 10, lastDone: { hoursTenths: 0 } }]) })).json()) as { id: string }
  const item = ((await (await request.get(`/api/bikes/${bike.id}`)).json()) as { items: Array<{ id: string; status: { state: string } }> }).items[0]!
  expect(['overdue', 'soon']).toContain(item.status.state)

  const oil = (await (await request.post('/api/parts', { data: { clientId: uuid(), name: 'Oil 10W40', bikeId: bike.id, itemIds: [item.id] } })).json()) as { id: string }
  const plug = (await (await request.post('/api/parts', { data: { clientId: uuid(), name: 'Plug', unit: 'pcs', minHundredths: 200, qtyHundredths: 100, startClientId: uuid() } })).json()) as { id: string }

  let list = (await (await request.get('/api/shopping')).json()) as List
  expect(list.auto.map((a) => [a.key, a.reason])).toEqual([[`due:${oil.id}`, 'due'], [`min:${plug.id}`, 'min']])
  expect(list.auto[0]!.detail).toMatch(/^Oil on Shop A — (overdue|due soon)$/)
  expect(list.auto[1]!.detail).toBe('keep 2, have 1')

  // Stocking the due part removes it.
  await request.post(`/api/parts/${oil.id}/movements`, { data: { clientId: uuid(), qtyHundredths: 100 } })
  list = (await (await request.get('/api/shopping')).json()) as List
  expect(list.auto.map((a) => a.reason)).toEqual(['min'])

  // Manual: create (idempotent), patch, tick, delete.
  const clientId = uuid()
  const body = { clientId, text: ' Chain lube ', bikeId: bike.id, partId: plug.id }
  const created = (await (await request.post('/api/shopping', { data: body })).json()) as Manual
  expect(created).toMatchObject({ text: 'Chain lube', bikeId: bike.id, bikeName: 'Shop A', partId: plug.id, doneAt: null })
  expect(((await (await request.post('/api/shopping', { data: body })).json()) as Manual).id).toBe(created.id)
  expect(((await (await request.get('/api/shopping')).json()) as List).manual).toHaveLength(1)

  const edited = (await (await request.patch(`/api/shopping/${created.id}`, { data: { text: 'Chain lube spray' } })).json()) as Manual
  expect(edited.text).toBe('Chain lube spray')
  const ticked = (await (await request.patch(`/api/shopping/${created.id}`, { data: { done: true } })).json()) as Manual
  expect(ticked.doneAt).not.toBeNull()
  expect(((await (await request.get('/api/shopping')).json()) as List).manual[0]!.doneAt).not.toBeNull()
  const unticked = (await (await request.patch(`/api/shopping/${created.id}`, { data: { done: false } })).json()) as Manual
  expect(unticked.doneAt).toBeNull()

  expect(await (await request.delete(`/api/shopping/${created.id}`)).json()).toEqual({ ok: true })
  expect(((await (await request.get('/api/shopping')).json()) as List).manual).toHaveLength(0)
})

test('shopping API: another rider gets 404 / 400 on foreign ids', async ({ playwright, baseURL }) => {
  const a = await playwright.request.newContext({ baseURL })
  const b = await playwright.request.newContext({ baseURL })
  await signUp(a, 'shop-a')
  await signUp(b, 'shop-b')
  const entry = (await (await a.post('/api/shopping', { data: { clientId: uuid(), text: 'Private' } })).json()) as Manual
  const bikeB = (await (await b.post('/api/bikes', { data: bikeBody('B bike', []) })).json()) as { id: string }
  const partB = (await (await b.post('/api/parts', { data: { clientId: uuid(), name: 'B part' } })).json()) as { id: string }

  expect((await b.patch(`/api/shopping/${entry.id}`, { data: { done: true } })).status()).toBe(404)
  expect((await b.delete(`/api/shopping/${entry.id}`)).status()).toBe(404)
  expect(((await (await b.get('/api/shopping')).json()) as List).manual).toHaveLength(0)
  expect((await a.post('/api/shopping', { data: { clientId: uuid(), text: 'x', bikeId: bikeB.id } })).status()).toBe(404)
  expect((await a.post('/api/shopping', { data: { clientId: uuid(), text: 'x', partId: partB.id } })).status()).toBe(400)
  await a.dispose()
  await b.dispose()
})
