import { msgs } from '~/lib/i18n'
import { getDb, notifyOutbox, offlineGeneration, type OutboxRow, type PendingPhoto } from './db'
import { describeError, listOutbox, retryable, statusOf } from './outbox'
import { listPhotos, photoForm } from './photos'
import type { Send } from './api'

export type FlushResult = {
  sent: number
  failed: number
  bikeIds: string[]
  /** Documents uploaded from offline photos (the rider reviews them next). */
  documents: string[]
  retryAt?: number
  /** The server said 401: nothing more is sent until that user's session is confirmed again. */
  paused?: boolean
}

const WRITE_TIMEOUT = 15_000
const UPLOAD_TIMEOUT = 60_000
/** Retryable failures (5xx, 408, 429) before a write is set aside for the rider to see. */
export const MAX_ATTEMPTS = 6
/** …or once it has kept failing this long (from its first failure, not from when it was queued). */
export const MAX_AGE_MS = 24 * 3_600_000
/** 5 s, 10 s, 20 s … capped at 5 min. */
export const backoff = (attempts: number) => Math.min(5_000 * 2 ** (attempts - 1), 300_000)

type LooseFetch = (url: string, opts?: { method?: string; body?: unknown; timeout?: number }) => Promise<unknown>
const defaultSend: Send = (url, opts) => (globalThis as unknown as { $fetch: LooseFetch }).$fetch(url, opts)

// A confirmed invoice answers a replayed confirm with 409: it did go through.
const confirmReplay = (row: OutboxRow, status: number) => status === 409 && /^\/api\/documents\/[^/]+\/confirm$/.test(row.url)

type Opts = {
  send?: Send
  now?: () => number
  force?: boolean
  /**
   * The user the server says is signed in right now (null: nobody, or no
   * answer). Asked once per flush; only that user's rows are sent, so a write
   * queued by one rider can never land in another rider's account.
   */
  currentUser: () => Promise<string | null>
}

let running: Promise<FlushResult> | null = null

/**
 * Replays the outbox, then the offline invoice photos, oldest first. No
 * Background Sync (iOS has none): this runs when the app starts, comes back
 * online or is foregrounded. One flush at a time; stops at the first network
 * error or retryable failure so order is kept; a refused write (other 4xx), or
 * one that ran out of retries, is set aside with its reason and the rest carry on.
 */
export function flushOutbox(opts: Opts): Promise<FlushResult> {
  if (!running) running = run(opts).finally(() => (running = null))
  return running
}

type Outcome = 'sent' | 'failed' | 'next-later' | 'stop' | 'pause'

async function run({ send = defaultSend, now = Date.now, force = false, currentUser }: Opts): Promise<FlushResult> {
  const db = getDb()
  const gen = offlineGeneration()
  const res: FlushResult = { sent: 0, failed: 0, bikeIds: [], documents: [] }
  const rows = (await listOutbox()).filter((r) => !r.error)
  const photos = (await listPhotos()).filter((p) => !p.error)
  if (!rows.length && !photos.length) return res

  const uid = await currentUser().catch(() => null)
  if (!uid) return res // signed out / unknown: never send anything

  const bikes = new Set<string>()
  let changed = false

  /** What to do with a failed send. Updates the row (attempts / error) in `table`. */
  async function onError(table: 'outbox' | 'pendingPhotos', row: { id?: number; attempts: number; firstFailedAt?: number }, err: unknown): Promise<Outcome> {
    const status = statusOf(err)
    if (status === undefined) return 'stop' // still no network: next trigger
    if (status === 401) return 'pause' // session gone: wait for this user to be confirmed again
    changed = true
    // An upload refused by the daily/waiting quota won't pass on a retry: set it aside with the reason.
    const quota = table === 'pendingPhotos' && status === 429
    if (retryable(status) && !quota) {
      const attempts = row.attempts + 1
      const firstFailedAt = row.firstFailedAt ?? now()
      if (attempts >= MAX_ATTEMPTS || now() - firstFailedAt >= MAX_AGE_MS) {
        await db[table].update(row.id!, { attempts, firstFailedAt, error: msgs().errors.unreachable(status) })
        res.failed++
        return 'failed'
      }
      res.retryAt = now() + backoff(attempts)
      await db[table].update(row.id!, { attempts, firstFailedAt, nextAt: res.retryAt })
      return 'stop'
    }
    await db[table].update(row.id!, { error: describeError(err) })
    res.failed++
    return 'failed'
  }

  const waiting = (r: { nextAt?: number }) => !force && r.nextAt && r.nextAt > now()

  // Signed out (or the data wiped) since this flush started: stop before sending anything else.
  const wiped = () => offlineGeneration() !== gen

  let halted = false
  for (const snap of rows.filter((r) => r.userId === uid)) {
    if (wiped()) {
      halted = true
      break
    }
    // Re-read the live row: it may have been discarded, set aside or retried since the snapshot.
    const row = await db.outbox.get(snap.id!)
    if (!row || row.error || row.userId !== uid) continue
    if (waiting(row)) {
      res.retryAt = row.nextAt
      halted = true
      break
    }
    let outcome: Outcome = 'sent'
    try {
      await send(row.url, { method: row.method, body: row.body, timeout: WRITE_TIMEOUT })
    } catch (err) {
      const status = statusOf(err)
      if (!(status !== undefined && confirmReplay(row, status))) outcome = await onError('outbox', row, err)
    }
    if (outcome === 'sent') {
      await db.outbox.delete(row.id!)
      changed = true
      res.sent++
      if (typeof row.body.bikeId === 'string') bikes.add(row.body.bikeId)
    } else if (outcome === 'pause') {
      res.paused = true
      halted = true
      break
    } else if (outcome === 'stop') {
      halted = true
      break
    }
  }

  if (!halted) {
    for (const snap of photos.filter((x) => x.userId === uid)) {
      if (wiped()) break
      const p = await db.pendingPhotos.get(snap.id!)
      if (!p || p.error || p.userId !== uid) continue
      if (waiting(p)) {
        res.retryAt = p.nextAt
        break
      }
      const outcome = await uploadPhoto(p).catch((err) => onError('pendingPhotos', p, err))
      if (outcome === 'pause') res.paused = true
      if (outcome === 'stop' || outcome === 'pause') break
    }
  }

  async function uploadPhoto(p: PendingPhoto): Promise<Outcome> {
    // A duplicate (same clientId or same bytes) answers 200 with the existing document: success.
    const doc = (await send('/api/documents', { method: 'POST', body: photoForm(p), timeout: UPLOAD_TIMEOUT })) as { id: string; duplicate?: boolean; status?: string }
    if (!doc.duplicate && doc.status === 'reading') {
      // Starts the read; a refusal (429 cap) already left the document in manual.
      await send(`/api/documents/${doc.id}/read`, { method: 'POST', body: { clientId: crypto.randomUUID() } }).catch(() => null)
    }
    await db.pendingPhotos.delete(p.id!)
    changed = true
    res.sent++
    res.documents.push(doc.id)
    return 'sent'
  }

  res.bikeIds = [...bikes]
  if (changed) notifyOutbox()
  return res
}
