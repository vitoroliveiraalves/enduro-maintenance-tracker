import { and, asc, desc, eq, gte, lte, inArray, sql } from 'drizzle-orm'
import { createError } from 'h3'
import { db } from '../db/client'
import { bikes, categories, documents, expenseItems, expenses, meterReadings, serviceItems, services } from '../db/schema'
import { itemRows } from '../utils/bikes'
import { bad, isDay, isUuid } from '../utils/validate'
import { countsHours, countsKm } from '../../shared/utils/meters'
import type { BikeMeters } from '../../shared/utils/meters'

export type Period = 'month' | 'year' | 'all'
export type CostsParams = { period: Period; date: string; bikeId?: string | null }
export type Range = { from: string | null; to: string | null }

/** Kept for callers/tests: a real "YYYY-MM-DD" in 1900–2100 (validate.ts `isDay`). */
export const isRealDate = (s: string) => isDay(s)
export const todayStr = (now = new Date()) => now.toISOString().slice(0, 10)

const lastDayOf = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate()
const pad = (n: number) => String(n).padStart(2, '0')

/** Parse and validate the shared query (period, date, bikeId). */
export function parseCostsQuery(q: Record<string, unknown>, now = new Date()): CostsParams {
  const period = q.period ?? 'month'
  if (period !== 'month' && period !== 'year' && period !== 'all') throw bad('Invalid period')
  const date = q.date === undefined || q.date === '' ? todayStr(now) : q.date
  if (!isDay(date)) throw bad('Invalid date')
  const bikeId = typeof q.bikeId === 'string' && q.bikeId ? q.bikeId : null
  return { period, date, bikeId }
}

/** Calendar-date boundaries of a period; plain strings, no timezones involved. */
export function periodRange(period: Period, date: string): Range {
  const y = Number(date.slice(0, 4))
  const m = Number(date.slice(5, 7))
  if (period === 'all') return { from: null, to: null }
  if (period === 'year') return { from: `${y}-01-01`, to: `${y}-12-31` }
  return { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(lastDayOf(y, m))}` }
}

/** Year-over-year ranges: current year to today's month-day (or the whole year when it is a past year). */
export function compareRanges(date: string, now = new Date()): { current: Range; previous: Range } {
  const y = Number(date.slice(0, 4))
  const today = todayStr(now)
  const thisYear = Number(today.slice(0, 4))
  let endMd = '12-31'
  if (y === thisYear) endMd = today.slice(5)
  else if (y > thisYear) endMd = '01-01'
  const [em, ed] = [Number(endMd.slice(0, 2)), Number(endMd.slice(3, 5))]
  const prevEnd = `${y - 1}-${pad(em)}-${pad(Math.min(ed, lastDayOf(y - 1, em)))}`
  return {
    current: { from: `${y}-01-01`, to: `${y}-${endMd}` },
    previous: { from: `${y - 1}-01-01`, to: prevEnd },
  }
}

export const comparePct = (current: number, previous: number): number | null =>
  previous === 0 ? null : Math.round(((current - previous) / previous) * 100)

/** Below this much riding a per-hour/per-km figure is noise (2.5 h → "485 €/h"), so none is shown. */
export const MIN_HOURS_TENTHS = 100
export const MIN_KM = 100

export const perUnitCents = (totalCents: number, tenthsOrKm: number, tenths: boolean): number | null =>
  tenthsOrKm < (tenths ? MIN_HOURS_TENTHS : MIN_KM) ? null : Math.round(totalCents / (tenths ? tenthsOrKm / 10 : tenthsOrKm))

type Rd = { day: string; hoursTenths: number | null; km: number | null }

/** Meter delta inside a period for one bike's readings (sorted ascending), each unit from the readings that have it. */
export function readingsDelta(rs: Rd[], range: Range): { hoursTenths: number; km: number } {
  const one = (pick: (r: Rd) => number | null): number => {
    const has = rs.filter((r) => pick(r) !== null)
    const inEnd = has.filter((r) => range.to === null || r.day <= range.to)
    const end = inEnd[inEnd.length - 1]
    if (!end) return 0
    const before = range.from === null ? [] : has.filter((r) => r.day < range.from!)
    const start = before[before.length - 1] ?? inEnd.find((r) => range.from === null || r.day >= range.from)
    return start ? Math.max(0, pick(end)! - pick(start)!) : 0
  }
  return { hoursTenths: one((r) => r.hoursTenths), km: one((r) => r.km) }
}

async function checkedBike(userId: string, bikeId: string | null | undefined) {
  if (!bikeId) return null
  const notFound = createError({ statusCode: 404, statusMessage: 'Not found' })
  if (!isUuid(bikeId)) throw notFound
  const [b] = await db.select().from(bikes).where(and(eq(bikes.id, bikeId), eq(bikes.userId, userId)))
  if (!b) throw notFound
  return b
}

async function sumCents(userId: string, range: Range, bikeId: string | null): Promise<number> {
  const rows = await db
    .select({ a: expenses.amountCents })
    .from(expenses)
    .where(
      and(
        eq(expenses.userId, userId),
        bikeId ? eq(expenses.bikeId, bikeId) : undefined,
        range.from ? gte(expenses.at, range.from) : undefined,
        range.to ? lte(expenses.at, range.to) : undefined,
      ),
    )
  return rows.reduce((s, r) => s + r.a, 0)
}

/** Expenses of the period with category/bike/invoice details, newest first. `userId` scopes everything. */
export async function costExpenses(userId: string, range: Range, bikeId: string | null) {
  return db
    .select({
      id: expenses.id,
      at: expenses.at,
      bikeId: expenses.bikeId,
      bikeName: bikes.name,
      categoryId: expenses.categoryId,
      categoryName: categories.name,
      description: expenses.description,
      amountCents: expenses.amountCents,
      documentId: expenses.documentId,
      serviceId: expenses.serviceId,
      invoiceNumber: documents.number,
    })
    .from(expenses)
    .innerJoin(categories, and(eq(expenses.categoryId, categories.id), eq(categories.userId, userId)))
    .leftJoin(bikes, and(eq(expenses.bikeId, bikes.id), eq(bikes.userId, userId)))
    .leftJoin(documents, and(eq(expenses.documentId, documents.id), eq(documents.userId, userId)))
    .where(
      and(
        eq(expenses.userId, userId),
        bikeId ? eq(expenses.bikeId, bikeId) : undefined,
        range.from ? gte(expenses.at, range.from) : undefined,
        range.to ? lte(expenses.at, range.to) : undefined,
      ),
    )
    .orderBy(desc(expenses.at), desc(expenses.createdAt))
}

async function upcoming(userId: string, bikeId: string) {
  const rows = (await itemRows(bikeId, userId)).filter((r) => r.status.state === 'overdue' || r.status.state === 'soon')
  if (!rows.length) return []
  const links = await db
    .select({ itemId: serviceItems.itemId, s: services })
    .from(serviceItems)
    .innerJoin(services, eq(serviceItems.serviceId, services.id))
    .where(and(inArray(serviceItems.itemId, rows.map((r) => r.id)), eq(services.userId, userId)))
  const n = (v: number | null) => v ?? Number.NEGATIVE_INFINITY
  return Promise.all(
    rows.map(async (r) => {
      // Same pick as the item status: highest hours, then km, then date.
      const last = links
        .filter((l) => l.itemId === r.id)
        .map((l) => l.s)
        .sort((a, b) => n(b.hoursTenths) - n(a.hoursTenths) || n(b.km) - n(a.km) || (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))[0]
      let estimateCents: number | null = null
      if (last) {
        const linked = await db
          .select({ id: expenses.id, a: expenses.amountCents })
          .from(expenseItems)
          .innerJoin(expenses, eq(expenseItems.expenseId, expenses.id))
          .where(and(eq(expenseItems.itemId, r.id), eq(expenses.serviceId, last.id), eq(expenses.userId, userId)))
        const rowsToSum = linked.length
          ? linked
          : await db
              .select({ id: expenses.id, a: expenses.amountCents })
              .from(expenses)
              .where(and(eq(expenses.serviceId, last.id), eq(expenses.userId, userId)))
        // Linked through expenseItems to this item's last service, else everything on that service.
        if (rowsToSum.length) estimateCents = rowsToSum.reduce((s, x) => s + x.a, 0)
      }
      return { itemId: r.id, name: r.name, state: r.status.state as 'overdue' | 'soon', estimateCents }
    }),
  )
}

export async function costsOverview(userId: string, p: CostsParams, now = new Date()) {
  const bike = await checkedBike(userId, p.bikeId)
  const bikeId = bike?.id ?? null
  const range = periodRange(p.period, p.date)
  const rows = await costExpenses(userId, range, bikeId)
  const totalCents = rows.reduce((s, r) => s + r.amountCents, 0)

  let compare: { previousToDateCents: number; pct: number | null } | null = null
  if (p.period === 'year') {
    const { current, previous } = compareRanges(p.date, now)
    const [cur, prev] = await Promise.all([sumCents(userId, current, bikeId), sumCents(userId, previous, bikeId)])
    compare = { previousToDateCents: prev, pct: comparePct(cur, prev) }
  }

  const userBikes = await db.select().from(bikes).where(and(eq(bikes.userId, userId), bikeId ? eq(bikes.id, bikeId) : undefined)).orderBy(asc(bikes.createdAt))
  const rds = await db
    .select()
    .from(meterReadings)
    .where(and(eq(meterReadings.userId, userId), bikeId ? eq(meterReadings.bikeId, bikeId) : undefined))
    .orderBy(asc(meterReadings.at), sql`${meterReadings.hoursTenths} asc nulls last`)
  const perBike = userBikes.map((b) => {
    const delta = readingsDelta(
      rds.filter((r) => r.bikeId === b.id).map((r) => ({ day: r.at.toISOString().slice(0, 10), hoursTenths: r.hoursTenths, km: r.km })),
      range,
    )
    const cents = rows.filter((r) => r.bikeId === b.id).reduce((s, r) => s + r.amountCents, 0)
    // Only the units the bike counts now (switched-off history stays stored, not summed).
    return {
      bikeId: b.id as string | null, name: b.name, meters: b.meters, cents,
      hoursTenths: countsHours(b.meters) ? delta.hoursTenths : 0,
      km: countsKm(b.meters) ? delta.km : 0,
    }
  })
  const hoursTenths = perBike.reduce((s, b) => s + b.hoursTenths, 0)
  const km = perBike.reduce((s, b) => s + b.km, 0)
  const anyHours = userBikes.some((b) => countsHours(b.meters))
  const anyKm = userBikes.some((b) => countsKm(b.meters))
  // Per-unit spend leaves out the bikes that don't count that unit (a street bike's costs aren't "per hour").
  const centsNot = (counts: (m: BikeMeters) => boolean) => perBike.filter((b) => !counts(b.meters)).reduce((s, b) => s + b.cents, 0)
  const noBike = rows.filter((r) => r.bikeId === null).reduce((s, r) => s + r.amountCents, 0)
  const byBike = perBike.filter((b) => b.cents > 0 || b.hoursTenths > 0 || b.km > 0)
  if (!bikeId && noBike > 0) byBike.push({ bikeId: null, name: 'No bike', meters: 'hours_km', cents: noBike, hoursTenths: 0, km: 0 })
  byBike.sort((a, b) => b.cents - a.cents)

  const catMap = new Map<string, { categoryId: string; name: string; cents: number }>()
  for (const r of rows) {
    const c = catMap.get(r.categoryId) ?? { categoryId: r.categoryId, name: r.categoryName, cents: 0 }
    c.cents += r.amountCents
    catMap.set(r.categoryId, c)
  }

  const byMonth =
    p.period === 'year'
      ? Array.from({ length: 12 }, (_, i) => ({
          month: i + 1,
          cents: rows.filter((r) => Number(r.at.slice(5, 7)) === i + 1).reduce((s, r) => s + r.amountCents, 0),
        }))
      : undefined

  return {
    totalCents,
    compare,
    perHourCents: perUnitCents(totalCents - centsNot(countsHours), hoursTenths, true),
    perKmCents: perUnitCents(totalCents - centsNot(countsKm), km, false),
    hoursTenths,
    km,
    countsHours: anyHours,
    countsKm: anyKm,
    ...(byMonth ? { byMonth } : {}),
    byCategory: [...catMap.values()].sort((a, b) => b.cents - a.cents),
    byBike,
    ...(p.period === 'month'
      ? {
          expenses: rows.map((r) => ({
            id: r.id, at: r.at, bikeId: r.bikeId, bikeName: r.bikeName, categoryName: r.categoryName,
            description: r.description, amountCents: r.amountCents, documentId: r.documentId, serviceId: r.serviceId,
          })),
        }
      : {}),
    ...(p.period === 'month' && bikeId ? { upcoming: await upcoming(userId, bikeId) } : {}),
  }
}

// ---- CSV ------------------------------------------------------------------

/** Quote a cell; prefix `'` to formula-looking text (CSV injection). */
export function csvCell(v: string): string {
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v
  return `"${safe.replace(/"/g, '""')}"`
}
export const eurosComma = (cents: number) => `${cents < 0 ? '-' : ''}${Math.floor(Math.abs(cents) / 100)},${String(Math.abs(cents) % 100).padStart(2, '0')}`

const BOM = String.fromCharCode(0xfeff)

export async function costsCsv(userId: string, p: CostsParams) {
  const bike = await checkedBike(userId, p.bikeId)
  const rows = await costExpenses(userId, periodRange(p.period, p.date), bike?.id ?? null)
  const head = ['date', 'bike', 'category', 'description', 'amount_eur', 'invoice_number']
  const lines = [head.map(csvCell).join(';')]
  for (const r of rows) {
    lines.push([r.at, r.bikeName ?? '', r.categoryName, r.description, eurosComma(r.amountCents), r.invoiceNumber ?? ''].map(csvCell).join(';'))
  }
  return `${BOM}${lines.join('\r\n')}\r\n`
}
