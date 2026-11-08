import { beforeEach, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { db } from '../../../server/db/client'
import { notificationsSent, pushSubscriptions, user } from '../../../server/db/schema'
import { createBike, itemRows } from '../../../server/utils/bikes'
import { createService } from '../../../server/utils/services'
import { parseSubscription, runNotify, type PushSender } from '../../../server/utils/push'

let uid: string
let bike: Awaited<ReturnType<typeof createBike>>
const day = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString().slice(0, 10)
const NOW = new Date() // runs on any weekday: keep readings fresh so no nudge interferes

function recorder(fail?: (endpoint: string) => number | undefined) {
  const calls: Array<{ endpoint: string; payload: { title: string; body: string; url: string } }> = []
  const send: PushSender = async (sub, payload) => {
    const code = fail?.(sub.endpoint)
    if (code) throw Object.assign(new Error(`push ${code}`), { statusCode: code })
    calls.push({ endpoint: sub.endpoint, payload: JSON.parse(payload) })
  }
  return { calls, send }
}

const sub = (userId: string, name: string) =>
  db.insert(pushSubscriptions).values({ userId, endpoint: `https://fcm.googleapis.com/fcm/send/${name}`, p256dh: 'p', auth: 'a', timezone: 'Europe/Lisbon' })

beforeEach(async () => {
  await db.execute(sql`TRUNCATE "user" CASCADE`)
  const [u] = await db.insert(user).values({ name: 'A', email: 'a@example.com' }).returning()
  uid = u!.id
  // 120 of 150 tenths since the change → ratio 0.8 → soon
  bike = await createBike(uid, {
    clientId: crypto.randomUUID(), name: 'KTM 300', make: 'KTM', model: '300', year: 2022, stroke: '2T', hoursTenths: 1420, km: 3800,
    items: [{ name: 'Gearbox oil', everyHoursTenths: 150, lastDone: { at: day(10), hoursTenths: 1300, km: 3700 } }],
  })
})

describe('runNotify', () => {
  it('an item crossing to soon is pushed once; the same state next hour sends nothing', async () => {
    await sub(uid, 'phone')
    const r = recorder()
    await runNotify({ now: NOW, send: r.send })
    expect(r.calls).toHaveLength(1)
    expect(r.calls[0]!.payload.title).toBe('Gearbox oil due soon')
    await runNotify({ now: new Date(NOW.getTime() + 3_600_000), send: r.send })
    expect(r.calls).toHaveLength(1)
    const keys = (await db.select().from(notificationsSent)).map((n) => n.key)
    expect(keys).toEqual([expect.stringMatching(/^item:[0-9a-f-]{36}:soon$/)])
  })

  it('fans out to every subscription of the user', async () => {
    await sub(uid, 'phone')
    await sub(uid, 'tablet')
    const r = recorder()
    await runNotify({ now: NOW, send: r.send })
    expect(r.calls.map((c) => c.endpoint).sort()).toEqual(['https://fcm.googleapis.com/fcm/send/phone', 'https://fcm.googleapis.com/fcm/send/tablet'])
  })

  it('410/404 from the push service deletes that subscription', async () => {
    await sub(uid, 'phone')
    await sub(uid, 'gone')
    const r = recorder((e) => (e.endsWith('/gone') ? 410 : undefined))
    await runNotify({ now: NOW, send: r.send })
    expect((await db.select().from(pushSubscriptions)).map((s) => s.endpoint)).toEqual(['https://fcm.googleapis.com/fcm/send/phone'])
  })

  it('a transient failure on every subscription releases the key so the next hour retries', async () => {
    await sub(uid, 'phone')
    let down = true
    const r = recorder(() => (down ? 503 : undefined))
    await runNotify({ now: NOW, send: r.send })
    expect(await db.select().from(notificationsSent)).toHaveLength(0)
    down = false
    await runNotify({ now: NOW, send: r.send })
    expect(r.calls).toHaveLength(1)
  })

  it('a service that makes the item ok re-arms the soon notification', async () => {
    await sub(uid, 'phone')
    const r = recorder()
    await runNotify({ now: NOW, send: r.send })
    const [item] = await itemRows(bike.id, uid)
    await createService(bike, { clientId: crypto.randomUUID(), at: day(0), hoursTenths: 1420, km: 3800, by: 'diy', itemIds: [item!.id] })
    await runNotify({ now: NOW, send: r.send })
    expect(await db.select().from(notificationsSent)).toHaveLength(0)
  })

  it('users without subscriptions are skipped and nothing is recorded; userId limits the run', async () => {
    const r = recorder()
    await runNotify({ now: NOW, send: r.send })
    expect(await db.select().from(notificationsSent)).toHaveLength(0)
    await sub(uid, 'phone')
    await runNotify({ now: NOW, send: r.send, userId: crypto.randomUUID() })
    expect(r.calls).toHaveLength(0)
    await runNotify({ now: NOW, send: r.send, userId: uid })
    expect(r.calls).toHaveLength(1)
  })
})

describe('parseSubscription', () => {
  const keys = { p256dh: 'BOr_abc-123', auth: 'xYz_9' }
  const bad = (raw: unknown) => {
    try {
      parseSubscription(raw)
      return 200
    } catch (e) {
      return (e as { statusCode?: number }).statusCode
    }
  }

  it('accepts real push services and keeps a valid timezone', () => {
    expect(parseSubscription({ endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys, timezone: 'Europe/Lisbon' })).toMatchObject({ timezone: 'Europe/Lisbon' })
    expect(parseSubscription({ endpoint: 'https://web.push.apple.com/QGx', keys, timezone: 'Nope/Nowhere' }).timezone).toBeNull()
  })

  it('rejects other hosts, plain http and bad keys (the server POSTs to the endpoint)', () => {
    expect(bad({ endpoint: 'https://169.254.169.254/latest', keys })).toBe(400)
    expect(bad({ endpoint: 'http://fcm.googleapis.com/fcm/send/abc', keys })).toBe(400)
    expect(bad({ endpoint: 'https://evil.com/.push.apple.com', keys })).toBe(400)
    expect(bad({ endpoint: 'https://fcm.googleapis.com.evil.com/x', keys })).toBe(400)
    expect(bad({ endpoint: 'https://fcm.googleapis.com/x', keys: { p256dh: 'a b', auth: 'x' } })).toBe(400)
    expect(bad({ endpoint: 'not a url', keys })).toBe(400)
  })
})
