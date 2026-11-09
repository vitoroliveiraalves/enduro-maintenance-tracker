import { countsHours, countsKm } from '../../shared/utils/meters'
import { and, eq, inArray, isNull, max } from 'drizzle-orm'
import webpush from 'web-push'
import { db } from '../db/client'
import { bikes, meterReadings, notificationsSent, pushSubscriptions, reminders } from '../db/schema'
import { DEFAULT_TIMEZONE, notificationsDue, validTimezone, type DueNotification, type NotifyInput } from '../domain/notify-rules'
import { isObj, itemRows } from './bikes'
import { bad } from './validate'

export type VapidConfig = { publicKey: string; privateKey: string; subject: string }
export type PushTarget = { endpoint: string; p256dh: string; auth: string }
/** Delivers one payload; throws an error carrying `statusCode` on push-service failures. */
export type PushSender = (sub: PushTarget, payload: string) => Promise<void>

/** VAPID keys from runtime config, or null when push isn't set up on this server. */
export function vapidFrom(c: { vapidPublicKey?: string; vapidPrivateKey?: string; vapidSubject?: string }): VapidConfig | null {
  if (!c.vapidPublicKey || !c.vapidPrivateKey) return null
  return { publicKey: c.vapidPublicKey, privateKey: c.vapidPrivateKey, subject: c.vapidSubject || 'mailto:admin@example.com' }
}

/** A push service slower than this fails that delivery (retried next hour) instead of hanging the run. */
export const PUSH_TIMEOUT_MS = 10_000

export function webPushSender(v: VapidConfig): PushSender {
  return async (sub, payload) => {
    await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload, {
      vapidDetails: v,
      TTL: 24 * 3600,
      timeout: PUSH_TIMEOUT_MS,
    })
  }
}

// Only real browser push services: the server POSTs to this URL, so never let
// a client point it at internal hosts.
const PUSH_HOSTS = ['fcm.googleapis.com', 'android.googleapis.com', '.push.apple.com', '.push.services.mozilla.com', '.notify.windows.com']
const B64URL = /^[A-Za-z0-9_-]+={0,2}$/

export function parseSubscription(raw: unknown) {
  if (!isObj(raw) || typeof raw.endpoint !== 'string' || raw.endpoint.length > 1000 || !isObj(raw.keys)) throw bad('Invalid subscription')
  let url: URL
  try {
    url = new URL(raw.endpoint)
  } catch {
    throw bad('Invalid subscription')
  }
  const host = url.hostname
  if (url.protocol !== 'https:' || !PUSH_HOSTS.some((h) => (h.startsWith('.') ? host.endsWith(h) : host === h))) throw bad('Unsupported push service')
  const { p256dh, auth } = raw.keys
  if (typeof p256dh !== 'string' || typeof auth !== 'string' || !B64URL.test(p256dh) || !B64URL.test(auth) || p256dh.length > 200 || auth.length > 100) {
    throw bad('Invalid subscription')
  }
  return { endpoint: raw.endpoint, p256dh, auth, timezone: validTimezone(raw.timezone) }
}

export async function saveSubscription(userId: string, raw: unknown) {
  const s = parseSubscription(raw)
  // One row per endpoint: a device that switched accounts now belongs to this user.
  await db
    .insert(pushSubscriptions)
    .values({ userId, ...s })
    .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: { userId, p256dh: s.p256dh, auth: s.auth, timezone: s.timezone } })
}

export async function removeSubscription(userId: string, raw: unknown) {
  if (!isObj(raw) || typeof raw.endpoint !== 'string') throw bad('Invalid endpoint')
  await db.delete(pushSubscriptions).where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, raw.endpoint)))
}

async function inputFor(userId: string, now: Date): Promise<Omit<NotifyInput, 'timezone'>> {
  const list = await db.select().from(bikes).where(and(eq(bikes.userId, userId), isNull(bikes.archivedAt)))
  const items: NotifyInput['items'] = []
  for (const b of list) {
    for (const row of await itemRows(b.id, userId, now)) {
      items.push({ bikeId: b.id, bikeName: b.name, itemId: row.id, itemName: row.name, lastServiceId: row.last?.serviceId ?? null, status: row.status })
    }
  }
  const [last] = list.length
    ? await db.select({ at: max(meterReadings.at) }).from(meterReadings).where(and(eq(meterReadings.userId, userId), inArray(meterReadings.bikeId, list.map((b) => b.id))))
    : []
  const open = await db.select().from(reminders).where(and(eq(reminders.userId, userId), isNull(reminders.doneAt)))
  return {
    now,
    items,
    reminders: open.map((r) => ({ id: r.id, title: r.title, dueOn: new Date(`${r.dueOn}T00:00:00Z`) })),
    lastReadingAt: last?.at ?? null,
    meters: { hours: list.some((b) => countsHours(b.meters)), km: list.some((b) => countsKm(b.meters)) },
  }
}

const statusOf = (e: unknown) => (e as { statusCode?: number })?.statusCode

/**
 * The hourly due-check. For every user with a push subscription: work out
 * what is due (per subscription timezone), claim each key in
 * notificationsSent (ON CONFLICT DO NOTHING) and push only when the claim
 * was new. Gone subscriptions (404/410) are deleted; when every delivery
 * failed for another reason the claim is released so the next run retries.
 */
export async function runNotify(opts: { now: Date; send: PushSender; userId?: string }) {
  const subs = await db
    .select()
    .from(pushSubscriptions)
    .where(opts.userId ? eq(pushSubscriptions.userId, opts.userId) : undefined)
  const byUser = new Map<string, typeof subs>()
  for (const s of subs) byUser.set(s.userId, [...(byUser.get(s.userId) ?? []), s])

  let sent = 0
  let failedUsers = 0
  for (const [userId, userSubs] of byUser) {
    // One user's bad data or a DB hiccup must not cost everyone else their reminders.
    try {
      sent += await notifyUser(userId, userSubs, opts)
    } catch (e) {
      failedUsers++
      console.error(`[notify] skipped user ${userId}:`, e)
    }
  }
  return { users: byUser.size, sent, failedUsers }
}

type Sub = typeof pushSubscriptions.$inferSelect

async function notifyUser(userId: string, userSubs: Sub[], opts: { now: Date; send: PushSender }): Promise<number> {
  let sent = 0
  const input = await inputFor(userId, opts.now)

  // Items back to ok can warn again next time they get close.
  const okKeys = input.items.filter((i) => i.status.state === 'ok').map((i) => `item:${i.itemId}:soon`)
  if (okKeys.length) await db.delete(notificationsSent).where(and(eq(notificationsSent.userId, userId), inArray(notificationsSent.key, okKeys)))

  const due = new Map<string, DueNotification>()
  for (const tz of new Set(userSubs.map((s) => validTimezone(s.timezone) ?? DEFAULT_TIMEZONE))) {
    for (const n of notificationsDue({ ...input, timezone: tz })) if (!due.has(n.key)) due.set(n.key, n)
  }

  let live = [...userSubs]
  for (const n of due.values()) {
    if (!live.length) break
    const claimed = await db.insert(notificationsSent).values({ userId, key: n.key }).onConflictDoNothing().returning({ id: notificationsSent.id })
    if (!claimed.length) continue
    const payload = JSON.stringify({ title: n.title, body: n.body, url: n.url, tag: n.key })
    let delivered = false
    for (const s of live) {
      try {
        await opts.send(s, payload)
        delivered = true
        sent++
      } catch (e) {
        const code = statusOf(e)
        if (code === 404 || code === 410) {
          await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, s.id))
          live = live.filter((x) => x.id !== s.id)
        } else {
          console.warn(`[notify] push failed (${code ?? 'network'}) for ${n.key}`)
        }
      }
    }
    if (!delivered) await db.delete(notificationsSent).where(eq(notificationsSent.id, claimed[0]!.id))
  }
  return sent
}
