import { expect, test } from '@playwright/test'
import type { APIRequestContext } from '@playwright/test'
import { bikeBody } from './helpers/seed'

const uuid = () => crypto.randomUUID()
const signUp = async (request: APIRequestContext, tag: string) => {
  const res = await request.post('/api/auth/sign-up/email', { data: { email: `${tag}-${uuid()}@example.com`, password: 'enduro-pass-1', name: 'rider' } })
  expect(res.ok()).toBeTruthy()
}
type Row = { id: string; name: string; unit: string; qtyHundredths: number; minHundredths: number | null; notes: string | null; bikeId: string | null; bikeName: string | null; itemIds: string[] }

test('parts API: round-trip, idempotent movements, bike/item rules', async ({ request }) => {
  await signUp(request, 'shelf')
  const bike = (await (await request.post('/api/bikes', { data: bikeBody('Shelf A', [{ name: 'Oil', everyHoursTenths: 150 }]) })).json()) as { id: string }
  const other = (await (await request.post('/api/bikes', { data: bikeBody('Shelf B', [{ name: 'Chain', everyKm: 1500 }]) })).json()) as { id: string }
  const itemOf = async (id: string) => ((await (await request.get(`/api/bikes/${id}`)).json()) as { items: Array<{ id: string }> }).items[0]!.id
  const oil = await itemOf(bike.id)
  const chain = await itemOf(other.id)

  // Create with a starting count; a replay (same clientId + startClientId) adds nothing twice.
  const clientId = uuid()
  const startClientId = uuid()
  const body = { clientId, startClientId, name: 'Spark plug', bikeId: bike.id, qtyHundredths: 200, minHundredths: 100, itemIds: [oil] }
  const created = (await (await request.post('/api/parts', { data: body })).json()) as Row
  expect(created).toMatchObject({ name: 'Spark plug', unit: 'pcs', qtyHundredths: 200, minHundredths: 100, bikeId: bike.id, bikeName: 'Shelf A', itemIds: [oil] })
  const replay = (await (await request.post('/api/parts', { data: body })).json()) as Row
  expect(replay.id).toBe(created.id)
  expect(replay.qtyHundredths).toBe(200)

  // Starting count needs its own clientId.
  expect((await request.post('/api/parts', { data: { clientId: uuid(), name: 'X', qtyHundredths: 100 } })).status()).toBe(400)
  // Items must belong to the part's bike (or any of the rider's bikes without one).
  expect((await request.post('/api/parts', { data: { clientId: uuid(), name: 'X', bikeId: bike.id, itemIds: [chain] } })).status()).toBe(400)
  expect((await request.post('/api/parts', { data: { clientId: uuid(), name: 'X', itemIds: [oil, chain] } })).status()).toBe(200)
  expect((await request.patch(`/api/parts/${created.id}`, { data: { itemIds: [chain] } })).status()).toBe(400)

  // Movement: signed, idempotent on clientId.
  const mv = { clientId: uuid(), qtyHundredths: -50, note: 'used one' }
  expect(((await (await request.post(`/api/parts/${created.id}/movements`, { data: mv })).json()) as Row).qtyHundredths).toBe(150)
  expect(((await (await request.post(`/api/parts/${created.id}/movements`, { data: mv })).json()) as Row).qtyHundredths).toBe(150)

  // Patch never changes the count; clearing the bike works.
  const patched = (await (await request.patch(`/api/parts/${created.id}`, { data: { name: 'NGK plug', bikeId: null, minHundredths: null, notes: 'BR8ES', qtyHundredths: 99999 } })).json()) as Row
  expect(patched).toMatchObject({ name: 'NGK plug', bikeId: null, bikeName: null, minHundredths: null, notes: 'BR8ES', qtyHundredths: 150, itemIds: [oil] })

  const detail = (await (await request.get(`/api/parts/${created.id}`)).json()) as Row & { history: Array<{ kind: string; qtyHundredths: number; note: string | null; unitCents: number | null }> }
  expect(detail.history.map((h) => h.qtyHundredths).sort((x, y) => x - y)).toEqual([-50, 200])
  expect(detail.history.every((h) => h.kind === 'adjust' && h.unitCents === null)).toBe(true)
  expect(detail.history).toHaveLength(2)

  // Moving the part to another bike drops fit links to the first bike's items.
  const moved = (await (await request.patch(`/api/parts/${created.id}`, { data: { bikeId: other.id } })).json()) as Row
  expect(moved).toMatchObject({ bikeId: other.id, itemIds: [] })

  // List sorted by name.
  await request.post('/api/parts', { data: { clientId: uuid(), name: 'Air filter' } })
  const names = ((await (await request.get('/api/parts')).json()) as Row[]).map((p) => p.name)
  expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'pt')))

  expect(await (await request.delete(`/api/parts/${created.id}`)).json()).toEqual({ ok: true })
  expect((await request.get(`/api/parts/${created.id}`)).status()).toBe(404)
})

test('parts API: another rider gets 404 on every id route', async ({ playwright, baseURL }) => {
  const a = await playwright.request.newContext({ baseURL })
  const b = await playwright.request.newContext({ baseURL })
  await signUp(a, 'shelf-a')
  await signUp(b, 'shelf-b')
  const part = (await (await a.post('/api/parts', { data: { clientId: uuid(), name: 'Private' } })).json()) as Row

  expect((await b.get(`/api/parts/${part.id}`)).status()).toBe(404)
  expect((await b.patch(`/api/parts/${part.id}`, { data: { name: 'Mine now' } })).status()).toBe(404)
  expect((await b.post(`/api/parts/${part.id}/movements`, { data: { clientId: uuid(), qtyHundredths: 100 } })).status()).toBe(404)
  expect((await b.delete(`/api/parts/${part.id}`)).status()).toBe(404)
  expect(((await (await b.get('/api/parts')).json()) as Row[]).length).toBe(0)
  // Another rider's bike cannot be attached either.
  const bikeB = (await (await b.post('/api/bikes', { data: bikeBody('B bike', []) })).json()) as { id: string }
  expect((await a.post('/api/parts', { data: { clientId: uuid(), name: 'X', bikeId: bikeB.id } })).status()).toBe(404)

  const still = (await (await a.get(`/api/parts/${part.id}`)).json()) as Row
  expect(still.name).toBe('Private')
  await a.dispose()
  await b.dispose()
})
