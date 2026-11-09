import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { bikeBody } from './helpers/seed'

/**
 * Bad dates, ids and numbers against every route that takes them: always a
 * 400 (or 404 for an id in the path), never a 500 from Postgres or toISOString.
 */
const BAD_DAYS = ['2026-13-45', '0000-01-01', '2026-02-30', 'yesterday']
const BAD_TIMES = ['0000-01-01T00:00:00Z', '2026-13-45T00:00:00Z', '+275760-09-13T00:00:00Z', '2026-02-30T10:00:00Z', 'nope']
const HUGE = 99_999_999_999
const today = () => new Date().toISOString().slice(0, 10)
const uuid = () => crypto.randomUUID()

test('bad input is a 400/404, never a 500', async ({ request }) => {
  const user = { email: `bad-${uuid()}@example.com`, password: 'enduro-pass-1', name: 'rider' }
  expect((await request.post('/api/auth/sign-up/email', { data: user })).ok()).toBeTruthy()

  // Fixtures: a bike with one item, a category, an expense, a reminder and an uploaded invoice.
  const bike = (await (await request.post('/api/bikes', { data: bikeBody('Bad input', [{ name: 'Oil', everyHoursTenths: 150 }]) })).json()) as { id: string }
  const detail = (await (await request.get(`/api/bikes/${bike.id}`)).json()) as { items: Array<{ id: string }> }
  const itemId = detail.items[0]!.id
  const categories = (await (await request.get('/api/categories')).json()) as Array<{ id: string }>
  const categoryId = categories[0]!.id
  const expense = (await (await request.post('/api/expenses', { data: { clientId: uuid(), at: today(), amountCents: 1000, categoryId } })).json()) as { id: string }
  const reminder = (await (await request.post('/api/reminders', { data: { clientId: uuid(), title: 'IUC', dueOn: '2027-03-15' } })).json()) as { id: string }
  const upload = await request.post('/api/documents', {
    multipart: { clientId: uuid(), files: { name: 'invoice.jpg', mimeType: 'image/jpeg', buffer: readFileSync('tests/e2e/fixtures/invoice-garage.jpg') } },
  })
  expect(upload.ok()).toBeTruthy()
  const docId = ((await upload.json()) as { id: string }).id
  const note = (await (await request.post(`/api/items/${itemId}/notes`, { data: { clientId: uuid(), title: 'Torque specs' } })).json()) as { id: string }
  for (const id of [bike.id, itemId, categoryId, expense.id, reminder.id, docId, note.id]) expect(id).toBeTruthy()

  type Case = [method: 'get' | 'post' | 'patch' | 'delete', url: string, data: unknown, expected: number]
  const cases: Case[] = []
  const svc = (over: object) => ({ clientId: uuid(), bikeId: bike.id, at: today(), by: 'diy', itemIds: [itemId], ...over })
  const exp = (over: object) => ({ clientId: uuid(), at: today(), amountCents: 100, categoryId, ...over })
  const rd = (over: object) => ({ clientId: uuid(), bikeId: bike.id, hoursTenths: 1430, km: 3820, ...over })
  const confirm = (over: object) => ({ bikeId: bike.id, at: today(), lines: [{ description: 'Oil', amountCents: 100, categoryId }], forceTotals: true, ...over })
  const withLast = (at: unknown) => bikeBody('X', [{ name: 'Oil', everyHoursTenths: 150, lastDone: { at, hoursTenths: 100 } }])

  for (const d of BAD_DAYS) {
    cases.push(
      ['get', `/api/costs?date=${d}`, null, 400],
      ['get', `/api/costs/export.csv?date=${d}`, null, 400],
      ['get', `/api/expenses?from=${d}`, null, 400],
      ['get', `/api/expenses?to=${d}`, null, 400],
      ['post', '/api/bikes', withLast(d), 400],
      ['post', '/api/items', { clientId: uuid(), bikeId: bike.id, name: 'Chain', everyKm: 1500, lastDone: { at: d } }, 400],
      ['post', '/api/services', svc({ at: d }), 400],
      ['post', '/api/expenses', exp({ at: d }), 400],
      ['patch', `/api/expenses/${expense.id}`, { at: d }, 400],
      ['post', '/api/reminders', { clientId: uuid(), title: 'IUC', dueOn: d }, 400],
      ['patch', `/api/reminders/${reminder.id}`, { dueOn: d }, 400],
      ['post', `/api/reminders/${reminder.id}/done`, { dueOn: d }, 400],
      ['post', `/api/documents/${docId}/confirm`, confirm({ at: d }), 400],
    )
  }
  for (const t of BAD_TIMES) cases.push(['post', '/api/readings', rd({ at: t }), 400])

  // Bad ids: in the path → 404; in the body → 400.
  for (const id of ['nope', '123', `${uuid()}x`]) {
    cases.push(
      ['get', `/api/bikes/${id}`, null, 404],
      ['patch', `/api/bikes/${id}`, { name: 'x' }, 404],
      ['get', `/api/readings/${id}`, null, 404],
      ['delete', `/api/bikes/${id}/latest-reading`, { readingId: uuid() }, 404],
      ['get', `/api/items/${id}/notes`, null, 404],
      ['post', `/api/items/${id}/notes`, { clientId: uuid(), title: 'x' }, 404],
      ['patch', `/api/notes/${id}`, { title: 'x' }, 404],
      ['delete', `/api/notes/${id}`, null, 404],
      ['get', `/api/notes/${id}/photos/${uuid()}`, null, 404],
      ['get', `/api/notes/${note.id}/photos/${id}`, null, 404],
      ['delete', `/api/notes/${note.id}/photos/${id}`, null, 404],
      ['post', `/api/items/${itemId}/notes`, { clientId: id, title: 'x' }, 400],
      ['patch', `/api/items/${id}`, { name: 'x' }, 404],
      ['get', `/api/items/${id}/history`, null, 404],
      ['delete', `/api/services/${id}`, null, 404],
      ['patch', `/api/expenses/${id}`, { amountCents: 1 }, 404],
      ['delete', `/api/expenses/${id}`, null, 404],
      ['patch', `/api/categories/${id}`, { name: 'x' }, 404],
      ['patch', `/api/reminders/${id}`, { title: 'x' }, 404],
      ['get', `/api/documents/${id}`, null, 404],
      ['get', `/api/documents/${id}/files/1`, null, 404],
      ['get', `/api/costs?bikeId=${id}`, null, 404],
      ['get', `/api/expenses?bikeId=${id}`, null, 404],
      ['post', '/api/readings', rd({ bikeId: id }), 404],
      ['post', '/api/bikes', { ...bikeBody('X', []), clientId: id }, 400],
      ['post', '/api/readings', rd({ clientId: id }), 400],
      ['delete', `/api/bikes/${bike.id}/latest-reading`, { readingId: id }, 400],
      ['post', '/api/services', svc({ itemIds: [id] }), 400],
      ['post', '/api/expenses', exp({ categoryId: id }), 400],
      ['post', '/api/reminders', { clientId: id, title: 'IUC', dueOn: '2027-03-15' }, 400],
    )
  }
  for (const page of ['99999999999', '0', '6', '-1', '1.5', 'abc']) cases.push(['get', `/api/documents/${docId}/files/${page}`, null, 404])
  for (const bikeId of [123, true, {}, []]) {
    cases.push(['patch', `/api/reminders/${reminder.id}`, { bikeId }, 400], ['post', '/api/reminders', { clientId: uuid(), title: 'IUC', dueOn: '2027-03-15', bikeId }, 400])
  }
  cases.push(['post', '/api/expenses', exp({ bikeId: 123 }), 400])
  cases.push(['post', `/api/reminders/${reminder.id}/done`, {}, 400]) // no dueOn: a blind replay could roll it twice

  // Bad notes.
  for (const body of [{ title: '' }, { title: 123 }, { title: 'x'.repeat(121) }, { title: 'x', body: 5 }, { title: 'x', specs: 'a' }, { title: 'x', specs: [{ label: '', value: '1' }] }, { title: 'x', specs: [{ label: 'a', value: 1 }] }]) {
    cases.push(['post', `/api/items/${itemId}/notes`, { clientId: uuid(), ...body }, 400], ['patch', `/api/notes/${note.id}`, body, 400])
  }
  cases.push(['post', `/api/notes/${note.id}/photos`, { clientId: uuid() }, 400]) // not multipart, no file

  // Bad push subscriptions (e2e build has VAPID keys, so push is configured).
  const pushKeys = { p256dh: 'x', auth: 'y' }
  for (const body of [
    {},
    { endpoint: 123, keys: pushKeys },
    { endpoint: 'http://10.0.0.1/push', keys: pushKeys },
    { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: 'nope' },
  ]) cases.push(['post', '/api/push/subscribe', body, 400])
  for (const body of [{}, { endpoint: 123 }]) cases.push(['post', '/api/push/unsubscribe', body, 400])
  // Account delete without the exact confirmation (never send the valid one here).
  for (const body of [{}, { confirm: 'delete' }, { confirm: true }]) cases.push(['delete', '/api/account', body, 400])

  // Bad numbers.
  for (const n of [HUGE, -1, 1.5, '12', null]) {
    cases.push(
      ['post', '/api/readings', rd({ hoursTenths: n }), 400],
      ['post', '/api/readings', rd({ km: n }), 400],
      ['post', '/api/bikes', { ...bikeBody('X', []), hoursTenths: n }, 400],
      ['post', '/api/expenses', exp({ amountCents: n }), 400],
      ['patch', `/api/expenses/${expense.id}`, { amountCents: n }, 400],
      ['post', `/api/documents/${docId}/confirm`, confirm({ lines: [{ description: 'Oil', amountCents: n, categoryId }] }), 400],
    )
  }
  for (const n of [HUGE, -1, 1.5]) {
    cases.push(
      ['post', '/api/services', svc({ hoursTenths: n }), 400],
      ['patch', `/api/bikes/${bike.id}`, { year: n }, 400],
      ['patch', `/api/items/${itemId}`, { everyKm: n }, 400],
      ['post', `/api/documents/${docId}/confirm`, confirm({ km: n }), 400],
    )
  }

  const failures: string[] = []
  for (const [method, url, data, expected] of cases) {
    const res = await request.fetch(url, { method, ...(data === null ? {} : { data }) })
    if (res.status() !== expected) failures.push(`${method.toUpperCase()} ${url} ${JSON.stringify(data)} → ${res.status()} (want ${expected})`)
  }
  expect(failures).toEqual([])
})
