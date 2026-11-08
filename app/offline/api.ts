import { cacheTableFor, readCache, writeCache, type Method, type OutboxRow } from './db'
import { overlay } from './overlay'
import { enqueue, hasPending, isNetworkError, OfflineError, pendingRows, statusOf } from './outbox'

export type Send = (url: string, opts?: { method?: string; body?: unknown; timeout?: number }) => Promise<unknown>
export type MutateOpts = {
  method?: Method
  /**
   * Opt in to the offline outbox: offline (or on a network error / 5xx) the
   * write is queued and replayed later with the same clientId. Only for
   * readings, services, expenses, reminders and bike/item create/patch.
   * Default: online-only, throws OfflineError without a connection.
   */
  queue?: boolean
}

export type Queued = { queued: true }
export const isQueued = (x: unknown): x is Queued => !!x && typeof x === 'object' && (x as { queued?: unknown }).queued === true

const GET_TIMEOUT = 12_000
const WRITE_TIMEOUT = 15_000

type Json = Record<string, unknown>
const asArray = (v: unknown) => (Array.isArray(v) ? (v as Json[]) : [])

/** Names for showing a queued write before it syncs, from whatever is cached. */
async function metaFor(url: string, body: Json): Promise<OutboxRow['meta']> {
  const path = url.split('?')[0]
  const meta: NonNullable<OutboxRow['meta']> = {}
  const bikeId = typeof body.bikeId === 'string' ? body.bikeId : null
  if (bikeId) {
    const d = (await readCache(`/api/bikes/${bikeId}`))?.data as { bike?: { name?: string }; items?: Json[] } | undefined
    const fromList = asArray((await readCache('/api/bikes'))?.data).find((b) => b.id === bikeId)
    meta.bikeName = d?.bike?.name ?? (fromList?.name as string | undefined)
    if (path === '/api/services' && Array.isArray(body.itemIds)) {
      const items = d?.items ?? []
      meta.itemNames = (body.itemIds as string[]).map((id) => items.find((i) => i.id === id)?.name as string | undefined).filter((x): x is string => !!x)
    }
  }
  if (path === '/api/expenses' && typeof body.categoryId === 'string') {
    meta.categoryName = asArray((await readCache('/api/categories'))?.data).find((c) => c.id === body.categoryId)?.name as string | undefined
  }
  return meta
}

/**
 * The data layer behind useApi(): network-first reads with a Dexie fallback,
 * and writes that are either online-only or (opt-in) queued in the outbox.
 */
export function createApi(deps: { send: Send; online: () => boolean; afterQueue?: () => void }) {
  const { send, online } = deps

  async function fromCache<T>(url: string): Promise<T> {
    const hit = await readCache(url)
    if (!hit) throw new OfflineError()
    return overlay(url, hit.data as T, await pendingRows())
  }

  async function get<T>(url: string): Promise<T> {
    const cacheable = cacheTableFor(url) !== null
    if (!online()) {
      if (!cacheable) throw new OfflineError()
      return fromCache<T>(url)
    }
    let data: T
    try {
      data = (await send(url, { timeout: GET_TIMEOUT })) as T
    } catch (err) {
      const status = statusOf(err)
      // No answer or a broken server: the last synced copy beats an error screen.
      if (status === undefined || status >= 500) {
        if (cacheable) return fromCache<T>(url)
        if (isNetworkError(err)) throw new OfflineError()
      }
      throw err
    }
    if (!cacheable) return data
    await writeCache(url, data)
    return overlay(url, data, await pendingRows())
  }

  async function mutate<T>(url: string, body: Json | FormData, opts: MutateOpts = {}): Promise<T> {
    const method = opts.method ?? 'POST'
    if (body instanceof FormData) {
      // Uploads are online-only (Task 12 ruling f): never queued.
      if (!online()) throw new OfflineError()
      try {
        return (await send(url, { method, body })) as T
      } catch (err) {
        throw isNetworkError(err) ? new OfflineError() : err
      }
    }
    const payload = 'clientId' in body ? body : { ...body, clientId: crypto.randomUUID() }

    if (!opts.queue) {
      if (!online()) throw new OfflineError()
      try {
        return (await send(url, { method, body: payload })) as T
      } catch (err) {
        throw isNetworkError(err) ? new OfflineError() : err
      }
    }

    // Writes already waiting go first (FIFO), so this one queues behind them.
    if (online() && !(await hasPending())) {
      try {
        return (await send(url, { method, body: payload, timeout: WRITE_TIMEOUT })) as T
      } catch (err) {
        const status = statusOf(err)
        // A real answer the rider must see (422, 404, 401…) goes back to the form.
        if (status !== undefined && status < 500 && status !== 408) throw err
      }
    }
    await enqueue({ clientId: String(payload.clientId), url, method, body: payload, meta: await metaFor(url, payload) })
    deps.afterQueue?.()
    return { queued: true } as T
  }

  return { get, mutate }
}
