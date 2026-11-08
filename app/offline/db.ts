import Dexie, { type Table } from 'dexie'

/** Last server response for one GET URL (the full URL, query included, is the key). */
export type CacheRow = { url: string; data: unknown; savedAt: number }

export type Method = 'POST' | 'PUT' | 'PATCH' | 'DELETE'

/** A write waiting for the network. Keyed by `clientId` on the server: a replay creates nothing new. */
export type OutboxRow = {
  id?: number
  clientId: string
  /** Who queued it (server-confirmed session at the time). Only ever sent under that same user's session. */
  userId: string
  url: string
  method: Method
  body: Record<string, unknown>
  createdAt: number
  /** Short human label for the pending sheet ("Ride · 145.0 h"). */
  label: string
  /** Local-only names resolved at queue time, for showing the write before it syncs. */
  meta?: { bikeName?: string; itemNames?: string[]; categoryName?: string }
  /** Failed attempts on a retryable error (5xx, 408, 429). A 401 pauses the queue instead. */
  attempts: number
  /** When the first of those failures happened: the 24 h give-up window counts from here, not from createdAt. */
  firstFailedAt?: number
  /** Backoff: don't retry before this time (ms). */
  nextAt?: number
  /** Set when the server refused it for good (other 4xx) or retries ran out: not retried until the rider taps Retry. */
  error?: string
}

/**
 * Invoice photos captured offline (Ruling R12), already downscaled. Bytes are
 * stored as ArrayBuffers (Blobs in IndexedDB are unreliable on older iOS).
 */
export type PendingPhoto = {
  id?: number
  clientId: string
  userId: string
  files: Array<{ data: ArrayBuffer; type: string; name: string }>
  qrRaw?: string
  createdAt: number
  attempts: number
  firstFailedAt?: number
  nextAt?: number
  error?: string
}

class OfflineDB extends Dexie {
  bikes!: Table<CacheRow, string>
  bikeDetail!: Table<CacheRow, string>
  itemHistory!: Table<CacheRow, string>
  costs!: Table<CacheRow, string>
  lists!: Table<CacheRow, string> // services, expenses, categories, reminders
  outbox!: Table<OutboxRow, number>
  pendingPhotos!: Table<PendingPhoto, number>

  constructor() {
    super('enduro-offline')
    this.version(1).stores({
      bikes: 'url',
      bikeDetail: 'url',
      itemHistory: 'url',
      costs: 'url',
      lists: 'url',
      outbox: '++id, clientId',
    })
    this.version(2).stores({ pendingPhotos: '++id, clientId' })
  }
}

let instance: OfflineDB | null = null
export function getDb(): OfflineDB {
  if (!instance) instance = new OfflineDB()
  return instance
}

export type CacheTable = 'bikes' | 'bikeDetail' | 'itemHistory' | 'costs' | 'lists'

/**
 * Which cache table a GET URL lives in, or null when it must never be cached
 * (documents and their file bytes, push keys, CSV export…).
 */
export function cacheTableFor(url: string): CacheTable | null {
  const path = url.split('?')[0]!
  if (path === '/api/bikes') return 'bikes'
  if (/^\/api\/bikes\/[^/]+$/.test(path)) return 'bikeDetail'
  if (/^\/api\/items\/[^/]+\/history$/.test(path)) return 'itemHistory'
  if (path === '/api/costs') return 'costs'
  if (['/api/services', '/api/expenses', '/api/categories', '/api/reminders'].includes(path)) return 'lists'
  // The stock item list for a new bike (not user data), so a bike can be added offline.
  if (/^\/api\/templates\/(2T|4T)$/.test(path)) return 'lists'
  return null
}

export async function readCache(url: string): Promise<CacheRow | undefined> {
  const t = cacheTableFor(url)
  if (!t) return undefined
  try {
    return await getDb()[t].get(url)
  } catch {
    return undefined
  }
}

export async function writeCache(url: string, data: unknown): Promise<void> {
  const t = cacheTableFor(url)
  if (!t) return
  try {
    await getDb()[t].put({ url, data, savedAt: Date.now() })
  } catch {
    // storage full / unavailable (private mode): the app still works online
  }
}

// Outbox change listeners (the pending badge).
const listeners = new Set<() => void>()
export function onOutboxChange(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
export function notifyOutbox() {
  listeners.forEach((fn) => fn())
}

// Bumped by every wipe (sign-out, account deletion, another rider): a flush that started before it stops.
let generation = 0
export const offlineGeneration = () => generation

/** Sign-out / account deletion: the next person on this device must see nothing. */
export async function clearOfflineData(): Promise<void> {
  generation++
  try {
    const db = getDb()
    await db.transaction('rw', db.tables, () => Promise.all(db.tables.map((t) => t.clear())))
  } catch {
    try {
      await Dexie.delete('enduro-offline')
      instance = null
    } catch {
      // nothing more we can do
    }
  }
  notifyOutbox()
}
