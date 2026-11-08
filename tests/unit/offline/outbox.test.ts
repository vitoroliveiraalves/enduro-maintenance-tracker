// Offline cache, outbox and sync (Task 12). Review Focus 3: a replay after a lost
// response must reuse the same clientId so the server creates nothing new.
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createApi, isQueued, type Send } from '../../../app/offline/api'
import { clearOfflineData, getDb } from '../../../app/offline/db'
import { dismissFailed, listOutbox, OfflineError, OFFLINE_MESSAGE } from '../../../app/offline/outbox'
import { flushOutbox } from '../../../app/offline/sync'

type Call = { url: string; method: string; body: Record<string, unknown> | undefined }
const netErr = () => Object.assign(new Error('fetch failed'), { name: 'FetchError' })
const httpErr = (statusCode: number, data: unknown = {}) => Object.assign(new Error(`HTTP ${statusCode}`), { statusCode, data })

let online = true
let calls: Call[] = []
const recorder = (impl?: (c: Call) => unknown): Send =>
  vi.fn(async (url: string, opts?: { method?: string; body?: unknown }) => {
    const c = { url, method: opts?.method ?? 'GET', body: opts?.body as Record<string, unknown> | undefined }
    calls.push(c)
    return impl ? impl(c) : { ok: true }
  })
const api = (send: Send) => createApi({ send, online: () => online })

const detail = (hoursTenths: number) => ({
  bike: { id: 'b1', name: 'KTM', year: 2023 },
  latestReading: { at: '2026-11-01T10:00:00.000Z', hoursTenths, km: 3812 },
  items: [{ id: 'i1', name: 'Engine/gear oil', status: { state: 'ok' } }],
})

beforeEach(async () => {
  online = true
  calls = []
  await clearOfflineData()
})

describe('mutate', () => {
  it('queues an opted-in write while offline and does not hit the network', async () => {
    online = false
    const send = recorder()
    const res = await api(send).mutate('/api/readings', { bikeId: 'b1', hoursTenths: 1450, km: 3900 }, { queue: true })
    expect(isQueued(res)).toBe(true)
    expect(send).not.toHaveBeenCalled()
    const rows = await listOutbox()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ url: '/api/readings', method: 'POST', body: { bikeId: 'b1', hoursTenths: 1450, km: 3900 } })
    expect(rows[0]!.body.clientId).toMatch(/^[0-9a-f-]{36}$/)
    expect(rows[0]!.clientId).toBe(rows[0]!.body.clientId)
    expect(typeof rows[0]!.createdAt).toBe('number')
  })

  it('queues an opted-in write when the request fails on the network', async () => {
    const send = recorder(() => {
      throw netErr()
    })
    const res = await api(send).mutate('/api/expenses', { amountCents: 4160, categoryId: 'c1', at: '2026-11-08' }, { queue: true })
    expect(isQueued(res)).toBe(true)
    expect(await listOutbox()).toHaveLength(1)
  })

  it('never queues a write that did not opt in: throws OfflineError instead', async () => {
    online = false
    const send = recorder()
    const err = await api(send).mutate('/api/account', { confirm: 'DELETE' }, { method: 'DELETE' }).catch((e) => e)
    expect(err).toBeInstanceOf(OfflineError)
    expect(err.message).toBe(OFFLINE_MESSAGE)
    expect(OFFLINE_MESSAGE).toBe("You're offline — try again when you're back online.")
    expect(send).not.toHaveBeenCalled()
    expect(await listOutbox()).toHaveLength(0)
  })

  it('a default (online-only) write that fails on the network throws OfflineError and is not queued', async () => {
    const send = recorder(() => {
      throw netErr()
    })
    const err = await api(send).mutate('/api/push/subscribe', { endpoint: 'x' }).catch((e) => e)
    expect(err).toBeInstanceOf(OfflineError)
    expect(await listOutbox()).toHaveLength(0)
  })

  it('a 4xx from an online opted-in write is thrown to the form, not queued', async () => {
    const send = recorder(() => {
      throw httpErr(422, { error: 'hours-decreased', last: { hoursTenths: 1440, km: 3800 } })
    })
    const err = await api(send).mutate('/api/readings', { bikeId: 'b1', hoursTenths: 1, km: 1 }, { queue: true }).catch((e) => e)
    expect(err.statusCode).toBe(422)
    expect(await listOutbox()).toHaveLength(0)
  })

  it('goes behind already-queued writes (FIFO) even when online', async () => {
    online = false
    const send = recorder()
    await api(send).mutate('/api/readings', { bikeId: 'b1', hoursTenths: 1450, km: 3900 }, { queue: true })
    online = true
    const res = await api(send).mutate('/api/readings', { bikeId: 'b1', hoursTenths: 1460, km: 3910 }, { queue: true })
    expect(isQueued(res)).toBe(true)
    expect(send).not.toHaveBeenCalled()
    expect((await listOutbox()).map((r) => r.body.hoursTenths)).toEqual([1450, 1460])
  })
})

describe('flushOutbox', () => {
  async function queueThree() {
    online = false
    const a = api(recorder())
    await a.mutate('/api/readings', { bikeId: 'b1', hoursTenths: 1450, km: 3900 }, { queue: true })
    await a.mutate('/api/services', { bikeId: 'b1', at: '2026-11-08', by: 'diy', itemIds: ['i1'] }, { queue: true })
    await a.mutate('/api/expenses', { amountCents: 4160, categoryId: 'c1', at: '2026-11-08' }, { queue: true })
    online = true
  }

  it('sends queued writes in FIFO order and empties the outbox', async () => {
    await queueThree()
    const send = recorder()
    const res = await flushOutbox({ send })
    expect(res).toMatchObject({ sent: 3, failed: 0 })
    expect(calls.map((c) => c.url)).toEqual(['/api/readings', '/api/services', '/api/expenses'])
    expect(await listOutbox()).toHaveLength(0)
  })

  it('stops at the first network error and keeps the rest in order', async () => {
    await queueThree()
    const send = recorder(() => {
      throw netErr()
    })
    const res = await flushOutbox({ send })
    expect(res).toMatchObject({ sent: 0, failed: 0 })
    expect(calls).toHaveLength(1)
    expect(await listOutbox()).toHaveLength(3)
  })

  it('a retry after a lost response replays the same clientId and the server creates one row (Review Focus 3)', async () => {
    online = false
    await api(recorder()).mutate('/api/readings', { bikeId: 'b1', hoursTenths: 1450, km: 3900 }, { queue: true })
    online = true
    // A server that dedupes on clientId, like the real one.
    const created = new Map<string, unknown>()
    let dropResponse = true
    const send = recorder((c) => {
      const id = c.body!.clientId as string
      if (!created.has(id)) created.set(id, c.body)
      if (dropResponse) {
        dropResponse = false
        throw netErr() // the write landed, the reply was lost (timeout)
      }
      return detail(1450)
    })
    expect(await flushOutbox({ send })).toMatchObject({ sent: 0 })
    expect(await listOutbox()).toHaveLength(1)
    expect(await flushOutbox({ send })).toMatchObject({ sent: 1 })
    expect(calls).toHaveLength(2)
    expect(calls[0]!.body!.clientId).toBe(calls[1]!.body!.clientId)
    expect(created.size).toBe(1)
    expect(await listOutbox()).toHaveLength(0)
  })

  it('drops a 422, reports it, keeps going, and lets the rider dismiss it', async () => {
    await queueThree()
    const send = recorder((c) => {
      if (c.url === '/api/readings') throw httpErr(422, { error: 'hours-decreased', last: { hoursTenths: 1440, km: 3800 } })
      return { ok: true }
    })
    const res = await flushOutbox({ send })
    expect(res).toMatchObject({ sent: 2, failed: 1 })
    const rows = await listOutbox()
    expect(rows).toHaveLength(1)
    expect(rows[0]!.error).toBe("Hours can't go down (last: 144.0 h)")
    // A failed row is never retried.
    calls = []
    expect(await flushOutbox({ send })).toMatchObject({ sent: 0, failed: 0 })
    expect(calls).toHaveLength(0)
    await dismissFailed(rows[0]!.id!)
    expect(await listOutbox()).toHaveLength(0)
  })

  it('keeps a 5xx write and backs off before retrying', async () => {
    await queueThree()
    let now = 1_000_000
    const fail = recorder(() => {
      throw httpErr(503)
    })
    expect(await flushOutbox({ send: fail, now: () => now })).toMatchObject({ sent: 0, failed: 0 })
    const [row] = await listOutbox()
    expect(row!.attempts).toBe(1)
    expect(row!.nextAt).toBeGreaterThan(now)
    expect(row!.error).toBeUndefined()
    const ok = recorder()
    calls = []
    await flushOutbox({ send: ok, now: () => now })
    expect(calls).toHaveLength(0) // still backing off
    now = row!.nextAt!
    expect(await flushOutbox({ send: ok, now: () => now })).toMatchObject({ sent: 3 })
  })

  it('a 200 replay counts as success', async () => {
    await queueThree()
    expect(await flushOutbox({ send: recorder(() => ({ id: 'existing' })) })).toMatchObject({ sent: 3, failed: 0 })
  })

  it('only one flush runs at a time', async () => {
    await queueThree()
    const send = recorder(async () => new Promise((r) => setTimeout(() => r({ ok: true }), 5)))
    const [a, b] = await Promise.all([flushOutbox({ send }), flushOutbox({ send })])
    expect(calls).toHaveLength(3)
    expect(a).toEqual(b)
  })

  it('reports the bikes it touched so the screen can refetch them', async () => {
    await queueThree()
    const res = await flushOutbox({ send: recorder() })
    expect(res.bikeIds).toEqual(['b1'])
  })
})

describe('get', () => {
  it('network first, writes the cache, falls back to it offline', async () => {
    const send = recorder(() => detail(1425))
    expect(await api(send).get('/api/bikes/b1')).toEqual(detail(1425))
    online = false
    calls = []
    expect(await api(send).get('/api/bikes/b1')).toEqual(detail(1425))
    expect(calls).toHaveLength(0)
  })

  it('falls back to the cache when the network fails while "online"', async () => {
    await api(recorder(() => [{ id: 'b1' }])).get('/api/bikes')
    const res = await api(
      recorder(() => {
        throw netErr()
      }),
    ).get('/api/bikes')
    expect(res).toEqual([{ id: 'b1' }])
  })

  it('keys the cache by full URL (costs query)', async () => {
    await api(recorder(() => ({ totalCents: 1 }))).get('/api/costs?period=month&date=2026-11-08')
    await api(recorder(() => ({ totalCents: 2 }))).get('/api/costs?period=year&date=2026-11-08')
    online = false
    expect(await api(recorder()).get('/api/costs?period=month&date=2026-11-08')).toEqual({ totalCents: 1 })
    expect(await api(recorder()).get('/api/costs?period=year&date=2026-11-08')).toEqual({ totalCents: 2 })
  })

  it('never caches documents; offline without a cache throws OfflineError', async () => {
    await api(recorder(() => ({ id: 'd1' }))).get('/api/documents/d1')
    online = false
    expect(await api(recorder()).get('/api/documents/d1').catch((e) => e)).toBeInstanceOf(OfflineError)
    expect(await api(recorder()).get('/api/bikes/nope').catch((e) => e)).toBeInstanceOf(OfflineError)
  })

  it('shows queued readings, services and expenses on top of the cached data', async () => {
    await api(recorder(() => detail(1425))).get('/api/bikes/b1')
    await api(recorder(() => [{ id: 'c1', name: 'Fuel', kind: 'fuel' }])).get('/api/categories')
    await api(recorder(() => [{ id: 'e0', at: '2026-11-01', amountCents: 100, categoryName: 'Fuel', description: '', bikeId: null, documentId: null, serviceId: null }])).get('/api/expenses')
    await api(recorder(() => [])).get('/api/services')
    online = false
    const a = api(recorder())
    await a.mutate('/api/readings', { bikeId: 'b1', hoursTenths: 1450, km: 3900, at: '2026-11-08T09:00:00.000Z' }, { queue: true })
    await a.mutate('/api/services', { bikeId: 'b1', at: '2026-11-08', by: 'diy', itemIds: ['i1'] }, { queue: true })
    await a.mutate('/api/expenses', { amountCents: 4160, categoryId: 'c1', at: '2026-11-08', description: 'Fuel at the track' }, { queue: true })

    const d = await a.get<ReturnType<typeof detail>>('/api/bikes/b1')
    expect(d.latestReading).toMatchObject({ hoursTenths: 1450, km: 3900, pending: true })
    expect(d.items[0]).toMatchObject({ id: 'i1', pendingSync: true })
    const ex = await a.get<Array<Record<string, unknown>>>('/api/expenses')
    expect(ex).toHaveLength(2)
    expect(ex[0]).toMatchObject({ amountCents: 4160, categoryName: 'Fuel', pending: true })
    const sv = await a.get<Array<Record<string, unknown>>>('/api/services')
    expect(sv[0]).toMatchObject({ itemNames: ['Engine/gear oil'], bikeName: 'KTM', pending: true })
  })
})

describe('clearOfflineData', () => {
  it('empties every table (sign-out / account deletion)', async () => {
    await api(recorder(() => detail(1425))).get('/api/bikes/b1')
    online = false
    await api(recorder()).mutate('/api/readings', { bikeId: 'b1', hoursTenths: 1450, km: 3900 }, { queue: true })
    await clearOfflineData()
    const db = getDb()
    for (const t of db.tables) expect(await t.count()).toBe(0)
  })
})
