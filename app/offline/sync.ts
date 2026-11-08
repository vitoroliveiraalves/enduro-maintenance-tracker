import { getDb, notifyOutbox, type OutboxRow } from './db'
import { describeError, pendingRows, retryable, statusOf } from './outbox'
import type { Send } from './api'

export type FlushResult = { sent: number; failed: number; bikeIds: string[]; retryAt?: number }

const WRITE_TIMEOUT = 15_000
/** 5 s, 10 s, 20 s … capped at 5 min. */
export const backoff = (attempts: number) => Math.min(5_000 * 2 ** (attempts - 1), 300_000)

type LooseFetch = (url: string, opts?: { method?: string; body?: unknown; timeout?: number }) => Promise<unknown>
const defaultSend: Send = (url, opts) => (globalThis as unknown as { $fetch: LooseFetch }).$fetch(url, opts)

// A confirmed invoice answers a replayed confirm with 409: it did go through.
const confirmReplay = (row: OutboxRow, status: number) => status === 409 && /^\/api\/documents\/[^/]+\/confirm$/.test(row.url)

let running: Promise<FlushResult> | null = null

/**
 * Replays the outbox, oldest first. No Background Sync (iOS has none): this
 * runs when the app starts, comes back online or is foregrounded. One flush at
 * a time; stops at the first network error or retryable failure so order is
 * kept; a refused write (other 4xx) is set aside with its reason and the rest
 * carry on.
 */
export function flushOutbox(opts: { send?: Send; now?: () => number; force?: boolean } = {}): Promise<FlushResult> {
  if (!running) running = run(opts).finally(() => (running = null))
  return running
}

async function run({ send = defaultSend, now = Date.now, force = false }: { send?: Send; now?: () => number; force?: boolean }): Promise<FlushResult> {
  const db = getDb()
  const res: FlushResult = { sent: 0, failed: 0, bikeIds: [] }
  const bikes = new Set<string>()
  let changed = false
  for (const row of await pendingRows()) {
    if (!force && row.nextAt && row.nextAt > now()) {
      res.retryAt = row.nextAt
      break
    }
    try {
      await send(row.url, { method: row.method, body: row.body, timeout: WRITE_TIMEOUT })
    } catch (err) {
      const status = statusOf(err)
      if (status === undefined) break // still no network: try again on the next trigger
      if (!confirmReplay(row, status)) {
        changed = true
        if (retryable(status)) {
          const attempts = row.attempts + 1
          res.retryAt = now() + backoff(attempts)
          await db.outbox.update(row.id!, { attempts, nextAt: res.retryAt })
          break
        }
        await db.outbox.update(row.id!, { error: describeError(err) })
        res.failed++
        continue
      }
    }
    await db.outbox.delete(row.id!)
    changed = true
    res.sent++
    if (typeof row.body.bikeId === 'string') bikes.add(row.body.bikeId)
  }
  res.bikeIds = [...bikes]
  if (changed) notifyOutbox()
  return res
}
