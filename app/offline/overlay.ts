import type { OutboxRow } from './db'

/**
 * Queued writes shown on top of the last server response, so a ride logged
 * offline moves the hours card and an expense shows in history before it
 * syncs. The cache itself always holds what the server said; this runs on
 * every read, so a fresh fetch never wipes a pending change. Nothing here
 * recomputes maintenance status (that stays on the server): touched items are
 * only flagged `pendingSync`.
 */
type Obj = Record<string, unknown>
type Reading = { at: string; hoursTenths: number; km: number; pending?: boolean }

const pathOf = (url: string) => url.split('?')[0]!
const queryOf = (url: string) => new URLSearchParams(url.split('?')[1] ?? '')
const str = (v: unknown) => (typeof v === 'string' ? v : null)
const num = (v: unknown) => (typeof v === 'number' ? v : null)
const day = (v: unknown, fallback: number) => (str(v) ?? new Date(fallback).toISOString()).slice(0, 10)

const isPost = (r: OutboxRow, path: string) => r.method === 'POST' && pathOf(r.url) === path
const readingsFor = (rows: OutboxRow[], bikeId: string) => rows.filter((r) => isPost(r, '/api/readings') && r.body.bikeId === bikeId)
const servicesFor = (rows: OutboxRow[], bikeId?: string) => rows.filter((r) => isPost(r, '/api/services') && (!bikeId || r.body.bikeId === bikeId))

/** The newest of the cached reading and the queued ones. */
function latest(current: Reading | null, queued: OutboxRow[]): Reading | null {
  let best = current
  for (const r of queued) {
    const h = num(r.body.hoursTenths)
    const k = num(r.body.km)
    if (h === null || k === null) continue
    const at = str(r.body.at) ?? new Date(r.createdAt).toISOString()
    if (!best || at >= best.at) best = { at, hoursTenths: h, km: k, pending: true }
  }
  return best
}

function serviceCost(r: OutboxRow): number {
  const ex = Array.isArray(r.body.expenses) ? (r.body.expenses as Obj[]) : []
  return ex.reduce((sum, e) => sum + (num(e.amountCents) ?? 0), 0)
}

/** Queued edits and count movements on one cached part row (movements add up, in hundredths). */
function applyPartRows(p: Obj, rows: OutboxRow[]) {
  const url = `/api/parts/${p.id as string}`
  for (const r of rows) {
    if (r.method === 'PATCH' && pathOf(r.url) === url) {
      for (const k of ['name', 'unit', 'minHundredths', 'notes', 'bikeId', 'itemIds']) if (k in r.body) p[k] = r.body[k]
      if ('bikeId' in r.body) p.bikeName = r.meta?.bikeName ?? null
      p.pendingSync = true
    }
    if (isPost(r, `${url}/movements`)) {
      p.qtyHundredths = (num(p.qtyHundredths) ?? 0) + (num(r.body.qtyHundredths) ?? 0)
      p.pendingSync = true
    }
  }
  // A queued service that used this part lowers its count too.
  for (const r of servicesFor(rows)) {
    const used = Array.isArray(r.body.partsUsed) ? (r.body.partsUsed as Obj[]) : []
    for (const u of used) {
      if (u.partId !== p.id) continue
      p.qtyHundredths = (num(p.qtyHundredths) ?? 0) - (num(u.qtyHundredths) ?? 0)
      p.pendingSync = true
    }
  }
}

export function overlay<T>(url: string, data: T, rows: OutboxRow[]): T {
  if (!rows.length || data === null || typeof data !== 'object') return data
  const out = JSON.parse(JSON.stringify(data)) as unknown
  const path = pathOf(url)
  const q = queryOf(url)

  if (/^\/api\/bikes\/[^/]+$/.test(path)) {
    const d = out as { bike?: { id: string }; latestReading: Reading | null; items?: Obj[] }
    const bikeId = d.bike?.id ?? path.slice('/api/bikes/'.length)
    d.latestReading = latest(d.latestReading, readingsFor(rows, bikeId))
    const touched = new Set(servicesFor(rows, bikeId).flatMap((r) => (Array.isArray(r.body.itemIds) ? (r.body.itemIds as string[]) : [])))
    for (const it of d.items ?? []) if (touched.has(it.id as string)) it.pendingSync = true
    return out as T
  }

  if (path === '/api/bikes' && Array.isArray(out)) {
    for (const b of out as Array<{ id: string; latestReading: Reading | null }>) b.latestReading = latest(b.latestReading, readingsFor(rows, b.id))
    for (const r of rows.filter((x) => isPost(x, '/api/bikes'))) {
      out.push({
        id: `pending-${r.clientId}`,
        name: str(r.body.name) ?? 'New bike',
        year: num(r.body.year),
        counts: { overdue: 0, soon: 0 },
        latestReading: { at: new Date(r.createdAt).toISOString(), hoursTenths: num(r.body.hoursTenths) ?? 0, km: num(r.body.km) ?? 0 },
        pending: true,
      })
    }
    return out as T
  }

  if (/^\/api\/items\/[^/]+\/history$/.test(path)) {
    const itemId = path.split('/')[3]!
    const h = out as { services?: Obj[]; pendingSync?: boolean }
    const mine = servicesFor(rows).filter((r) => Array.isArray(r.body.itemIds) && (r.body.itemIds as string[]).includes(itemId))
    if (mine.length) {
      h.pendingSync = true
      const add = mine.reverse().map((r) => ({
        id: `pending-${r.clientId}`,
        at: day(r.body.at, r.createdAt),
        hoursTenths: num(r.body.hoursTenths),
        km: num(r.body.km),
        by: r.body.by === 'garage' ? 'garage' : 'diy',
        garageName: str(r.body.garageName),
        costCents: serviceCost(r),
        documentId: null,
        pending: true,
      }))
      h.services = [...add, ...(h.services ?? [])]
    }
    return out as T
  }

  if (path === '/api/services' && Array.isArray(out)) {
    const bikeId = q.get('bikeId') ?? undefined
    const add = servicesFor(rows, bikeId)
      .reverse()
      .map((r) => ({
        id: `pending-${r.clientId}`,
        bikeId: r.body.bikeId,
        bikeName: r.meta?.bikeName ?? '',
        at: day(r.body.at, r.createdAt),
        notes: null,
        hoursTenths: num(r.body.hoursTenths),
        km: num(r.body.km),
        by: r.body.by === 'garage' ? 'garage' : 'diy',
        garageName: str(r.body.garageName),
        documentId: null,
        itemNames: r.meta?.itemNames ?? [],
        totalCents: serviceCost(r),
        pending: true,
      }))
    return [...add, ...out] as T
  }

  if (path === '/api/expenses' && Array.isArray(out)) {
    const bikeId = q.get('bikeId')
    const add = rows
      .filter((r) => isPost(r, '/api/expenses') && (!bikeId || r.body.bikeId === bikeId))
      .reverse()
      .map((r) => ({
        id: `pending-${r.clientId}`,
        bikeId: str(r.body.bikeId),
        at: day(r.body.at, r.createdAt),
        amountCents: num(r.body.amountCents) ?? 0,
        categoryName: r.meta?.categoryName ?? 'Expense',
        description: str(r.body.description) ?? '',
        documentId: null,
        serviceId: null,
        pending: true,
      }))
    return [...add, ...out] as T
  }

  if (path === '/api/parts' && Array.isArray(out)) {
    for (const p of out as Obj[]) applyPartRows(p, rows)
    const add = rows
      .filter((r) => isPost(r, '/api/parts'))
      .map((r) => ({
        id: `pending-${r.clientId}`,
        name: str(r.body.name) ?? '',
        unit: str(r.body.unit) ?? 'pcs',
        qtyHundredths: num(r.body.qtyHundredths) ?? 0,
        minHundredths: num(r.body.minHundredths),
        notes: str(r.body.notes),
        bikeId: str(r.body.bikeId),
        bikeName: r.meta?.bikeName ?? null,
        itemIds: Array.isArray(r.body.itemIds) ? r.body.itemIds : [],
        pending: true,
      }))
    return [...out, ...add].sort((a, b) => String(a.name).localeCompare(String(b.name), 'pt')) as T
  }

  if (/^\/api\/parts\/[^/]+$/.test(path) && !Array.isArray(out)) {
    applyPartRows(out as Obj, rows)
    return out as T
  }

  if (path === '/api/shopping' && !Array.isArray(out)) {
    const d = out as { manual?: Obj[] }
    const manual = d.manual ?? []
    for (const e of manual) {
      for (const r of rows) {
        if (r.method !== 'PATCH' || pathOf(r.url) !== `/api/shopping/${e.id as string}`) continue
        if (typeof r.body.text === 'string') e.text = r.body.text
        if (typeof r.body.done === 'boolean') e.doneAt = r.body.done ? (e.doneAt ?? new Date(r.createdAt).toISOString()) : null
        e.pendingSync = true
      }
    }
    for (const r of rows.filter((x) => isPost(x, '/api/shopping'))) {
      manual.push({
        id: `pending-${r.clientId}`,
        text: str(r.body.text) ?? '',
        bikeId: str(r.body.bikeId),
        bikeName: r.meta?.bikeName ?? null,
        partId: str(r.body.partId),
        doneAt: null,
        pending: true,
      })
    }
    d.manual = manual
    return out as T
  }

  if (path === '/api/reminders' && Array.isArray(out)) {
    const bikeId = q.get('bikeId')
    const removed = new Set(rows.filter((r) => r.method === 'DELETE' && /^\/api\/reminders\/[^/]+$/.test(pathOf(r.url))).map((r) => pathOf(r.url).split('/')[3]))
    const kept = (out as Obj[]).filter((r) => !removed.has(r.id as string))
    const add = rows
      .filter((r) => isPost(r, '/api/reminders') && (!bikeId || !r.body.bikeId || r.body.bikeId === bikeId))
      .map((r) => ({
        id: `pending-${r.clientId}`,
        bikeId: str(r.body.bikeId),
        bikeName: r.meta?.bikeName ?? null,
        title: str(r.body.title) ?? '',
        dueOn: str(r.body.dueOn) ?? '',
        repeatYearly: r.body.repeatYearly === true,
        pending: true,
      }))
    return [...kept, ...add].sort((a, b) => String(a.dueOn).localeCompare(String(b.dueOn))) as T
  }

  return out as T
}
