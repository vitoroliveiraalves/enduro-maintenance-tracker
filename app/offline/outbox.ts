import { formatHours, formatKm, formatMoney, formatQty } from '~/lib/format'
import { getDb, notifyOutbox, type OutboxRow } from './db'

export const OFFLINE_MESSAGE = "You're offline — try again when you're back online."
export const SIGNED_OUT_MESSAGE = 'You were signed out. Sign in again, then save.'

/** A write that only makes sense online (auth, uploads, account, push…) was tried without a connection. */
export class OfflineError extends Error {
  readonly offline = true
  constructor() {
    super(OFFLINE_MESSAGE)
    this.name = 'OfflineError'
  }
}

/** HTTP status of a $fetch error, or undefined when the request never got an answer. */
export function statusOf(err: unknown): number | undefined {
  const e = err as { statusCode?: number; status?: number; response?: { status?: number } } | null
  const s = e?.statusCode ?? e?.status ?? e?.response?.status
  return typeof s === 'number' && s > 0 ? s : undefined
}

export const isNetworkError = (err: unknown) => !(err instanceof OfflineError) && statusOf(err) === undefined

/** Worth retrying later: server errors, timeout, rate limit. (401 pauses the whole queue instead.) */
export function retryable(status: number): boolean {
  return status >= 500 || [408, 429].includes(status)
}

/**
 * What a form shows for a failed call: the offline sentence, else the server's
 * message (unless `fallbackOnly`), else `fallback`.
 */
export function errorMessage(err: unknown, fallback: string, fallbackOnly = false): string {
  if (err instanceof OfflineError) return OFFLINE_MESSAGE
  if (statusOf(err) === 401) return SIGNED_OUT_MESSAGE
  if (fallbackOnly) return fallback
  const e = err as { statusMessage?: string; data?: { statusMessage?: string } } | null
  return e?.data?.statusMessage ?? e?.statusMessage ?? fallback
}

type ErrData = { error?: string; warn?: string; statusMessage?: string; last?: { hoursTenths: number | null; km: number | null } | null }

/** Why the server refused a queued write, in the words the forms use. */
export function describeError(err: unknown): string {
  const status = statusOf(err)
  const d = ((err as { data?: ErrData } | null)?.data ?? {}) as ErrData
  const last = d.last
  if (last) {
    const h = last.hoursTenths !== null ? formatHours(last.hoursTenths) : null
    const k = last.km !== null ? formatKm(last.km) : null
    if (d.error === 'hours-decreased' && h) return `Hours can't go down (last: ${h})`
    if (d.error === 'km-decreased' && k) return `Km can't go down (last: ${k})`
    if (d.error === 'hours-exceed-later' && h) return `Hours can't be above a later reading (${h})`
    if (d.error === 'km-exceed-later' && k) return `Km can't be above a later reading (${k})`
    if (d.warn === 'big-jump' && (h || k)) return `Big jump since the last reading (${h ?? k}) — log it again to confirm`
  }
  if (d.statusMessage) return d.statusMessage
  if (status === 404) return 'It no longer exists (deleted on another device?)'
  return `The server refused it (${status ?? 'error'})`
}

const s = (v: unknown) => (typeof v === 'string' ? v : '')
const n = (v: unknown) => (typeof v === 'number' ? v : null)

/** Short description of a queued write for the pending sheet. */
export function labelFor(url: string, method: string, body: Record<string, unknown>, meta: OutboxRow['meta'] = {}): string {
  const path = url.split('?')[0]!
  if (path === '/api/readings') {
    const h = n(body.hoursTenths)
    const k = n(body.km)
    return ['Ride', h !== null ? formatHours(h) : null, k !== null ? formatKm(k) : null].filter(Boolean).join(' · ')
  }
  if (path === '/api/services') return `Service · ${meta.itemNames?.join(', ') || 'items'}`
  if (path === '/api/expenses') {
    const c = n(body.amountCents)
    return ['Expense', meta.categoryName, c !== null ? formatMoney(c) : null].filter(Boolean).join(' · ')
  }
  if (path.startsWith('/api/reminders')) {
    if (method === 'DELETE') return 'Remove reminder'
    if (path.endsWith('/done')) return 'Reminder done'
    return `Reminder · ${s(body.title)}`
  }
  if (path === '/api/parts') return `New part · ${s(body.name)}`
  if (path.endsWith('/movements')) {
    const q = n(body.qtyHundredths)
    return `Shelf count${q !== null ? ` · ${formatQty(q)}` : ''}`
  }
  if (path.startsWith('/api/parts/')) return 'Part changes'
  if (path.startsWith('/api/shopping')) return 'To buy change'
  if (path === '/api/bikes') return `New bike · ${s(body.name)}`
  if (path.startsWith('/api/bikes/')) return 'Bike changes'
  if (path === '/api/items') return `New item · ${s(body.name)}`
  if (path.startsWith('/api/items/')) return 'Item intervals'
  return 'Change'
}

export async function enqueue(row: Omit<OutboxRow, 'id' | 'createdAt' | 'attempts' | 'label'>): Promise<OutboxRow> {
  const full: OutboxRow = { ...row, createdAt: Date.now(), attempts: 0, label: labelFor(row.url, row.method, row.body, row.meta) }
  full.id = await getDb().outbox.add(full)
  notifyOutbox()
  return full
}

/** Every row, oldest first (FIFO): pending ones and refused ones (with `error`). */
export async function listOutbox(): Promise<OutboxRow[]> {
  try {
    return await getDb().outbox.orderBy('id').toArray()
  } catch {
    return []
  }
}

export async function pendingRows(): Promise<OutboxRow[]> {
  return (await listOutbox()).filter((r) => !r.error)
}

export async function hasPending(): Promise<boolean> {
  return (await pendingRows()).length > 0
}

/** The rider read the refusal, or chose to discard a waiting change: forget the write. */
export async function dismissFailed(id: number): Promise<void> {
  await getDb().outbox.delete(id)
  notifyOutbox()
}

/** Retry a set-aside write: back in the queue (same place, same clientId) with a fresh retry count. */
export async function retryFailed(id: number): Promise<void> {
  await getDb().outbox.update(id, { error: undefined, attempts: 0, firstFailedAt: undefined, nextAt: undefined })
  notifyOutbox()
}
