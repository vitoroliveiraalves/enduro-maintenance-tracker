import { countsHours, countsKm, type BikeMeters } from '../../shared/utils/meters'
import { matches } from '../../shared/utils/search'
import { and, eq } from 'drizzle-orm'
import { db } from '../db/client'
import { bikes, categoryKinds } from '../db/schema'
import { costsOverview, periodRange, todayStr, type Period } from '../domain/costs-query'
import { itemRows, listBikes } from './bikes'
import { listCategories } from './categories'
import { itemHistory } from './item-history'
import { listPartRows } from './parts'
import { listReminders } from './reminders'
import { shoppingList } from './shopping'
import { isDay, isUuid } from './validate'

/** OpenAI-style function schema, as sent to the model. */
export type ToolDef = {
  type: 'function'
  function: { name: string; description: string; parameters: { type: 'object'; properties: Record<string, unknown>; required?: string[] } }
}

const fn = (name: string, description: string, properties: Record<string, unknown> = {}, required: string[] = []): ToolDef => ({
  type: 'function',
  function: { name, description, parameters: { type: 'object', properties, ...(required.length ? { required } : {}) } },
})
const id = { type: 'string', description: 'uuid from an earlier tool result' }

export const VOICE_TOOLS: ToolDef[] = [
  fn('list_bikes', "The rider's bikes: id, name, which meters each counts, latest hours (tenths) and km."),
  fn('item_status', 'Maintenance items of one bike with state, use since last done, last done and interval.', { bikeId: id }, ['bikeId']),
  fn('item_history', 'Past services of one maintenance item, newest first.', { itemId: id, limit: { type: 'integer', minimum: 1, maximum: 10 } }, ['itemId']),
  fn('search_shelf', 'Spare parts on the shelf matching words (accents and case ignored). Quantities in hundredths.', { query: { type: 'string' } }, ['query']),
  fn('shopping_list', 'Parts to buy: automatic entries (due items without stock, below minimum) and manual entries.'),
  fn('costs', 'Money spent (cents) in a period, by category.', {
    period: { type: 'string', enum: ['month', 'year', 'all'] },
    date: { type: 'string', description: 'YYYY-MM-DD inside the period; default today' },
    bikeId: id,
    categoryKind: { type: 'string', enum: [...categoryKinds] },
  }, ['period']),
  fn('reminders', 'Upcoming paperwork reminders (insurance, inspection…) not yet done, soonest first.'),
]

const NOT_FOUND = { error: 'not found' }
type Args = Record<string, unknown>

/** Drops the meter fields a bike does not count (keys removed, not nulled). */
function counted<T extends Record<string, unknown>>(meters: BikeMeters, o: T, hoursKey: keyof T, kmKey: keyof T): T {
  const drop = new Set<keyof T>([...(countsHours(meters) ? [] : [hoursKey]), ...(countsKm(meters) ? [] : [kmKey])])
  return Object.fromEntries(Object.entries(o).filter(([k]) => !drop.has(k))) as T
}

async function ownedMeters(userId: string, bikeId: unknown): Promise<BikeMeters | null> {
  if (!isUuid(bikeId)) return null
  const [b] = await db.select({ meters: bikes.meters }).from(bikes).where(and(eq(bikes.id, bikeId), eq(bikes.userId, userId)))
  return b?.meters ?? null
}

const isNotFound = (e: unknown) => (e as { statusCode?: number })?.statusCode === 404

const handlers: Record<string, (userId: string, a: Args, now: Date) => Promise<unknown>> = {
  async list_bikes(userId) {
    return (await listBikes(userId)).map((b) =>
      counted(b.meters, {
        id: b.id, name: b.name, make: b.make, model: b.model, year: b.year, meters: b.meters,
        hoursTenths: b.latestReading?.hoursTenths ?? null, km: b.latestReading?.km ?? null,
        readingAt: b.latestReading?.at ?? null, overdue: b.counts.overdue, soon: b.counts.soon,
      }, 'hoursTenths', 'km'),
    )
  },

  async item_status(userId, a, now) {
    const meters = await ownedMeters(userId, a.bikeId)
    if (!meters) return NOT_FOUND
    const rows = await itemRows(a.bikeId as string, userId, now)
    return {
      meters,
      items: rows.map((r) =>
        counted(meters, {
          id: r.id, name: r.name, state: r.status.state,
          sinceHoursTenths: r.status.sinceHoursTenths, sinceKm: r.status.sinceKm, sinceMonths: r.status.sinceMonths,
          lastDone: r.last
            ? counted(meters, {
                at: r.last.dateUnknown ? null : r.last.at.toISOString().slice(0, 10),
                hoursTenths: r.last.hoursTenths ?? null, km: r.last.km ?? null, by: r.last.by,
              }, 'hoursTenths', 'km')
            : null,
          interval: { ...r.def, conditionMultipliers: undefined },
          stock: r.stock,
        }, 'sinceHoursTenths', 'sinceKm'),
      ),
    }
  },

  async item_history(userId, a) {
    if (!isUuid(a.itemId)) return NOT_FOUND
    const limit = Number.isInteger(a.limit) ? Math.min(Math.max(a.limit as number, 1), 10) : 10
    try {
      const h = await itemHistory(a.itemId, userId)
      return h.services.slice(0, limit).map((s) => ({
        at: s.atUnknown ? null : String(s.at).slice(0, 10),
        ...(s.hoursTenths !== null ? { hoursTenths: s.hoursTenths } : {}),
        ...(s.km !== null ? { km: s.km } : {}),
        by: s.by, garageName: s.garageName, partsUsed: s.partsUsed, totalCents: s.costCents,
      }))
    } catch (e) {
      if (isNotFound(e)) return NOT_FOUND
      throw e
    }
  },

  async search_shelf(userId, a) {
    const q = typeof a.query === 'string' ? a.query.slice(0, 80) : ''
    return (await listPartRows(userId))
      .filter((p) => matches(q, p.name, p.notes, p.bikeName))
      .slice(0, 20)
      .map((p) => ({ id: p.id, name: p.name, unit: p.unit, qtyHundredths: p.qtyHundredths, minHundredths: p.minHundredths, bikeName: p.bikeName }))
  },

  async shopping_list(userId, _a, now) {
    return shoppingList(userId, now)
  },

  async costs(userId, a, now) {
    if (!['month', 'year', 'all'].includes(a.period as string)) return { error: 'invalid period' }
    if (a.date !== undefined && !isDay(a.date)) return { error: 'invalid date' }
    if (a.categoryKind !== undefined && !(categoryKinds as readonly unknown[]).includes(a.categoryKind)) return { error: 'invalid categoryKind' }
    if (a.bikeId !== undefined && a.bikeId !== null && !(await ownedMeters(userId, a.bikeId))) return NOT_FOUND
    const p = { period: a.period as Period, date: (a.date as string) ?? todayStr(now), bikeId: (a.bikeId as string) ?? null }
    const o = await costsOverview(userId, p, now)
    const range = periodRange(p.period, p.date)
    const kinds = new Map((await listCategories(userId)).map((c) => [c.id, c.kind]))
    const byCategory = o.byCategory
      .map((c) => ({ name: c.name, kind: kinds.get(c.categoryId) ?? 'other', cents: c.cents }))
      .filter((c) => !a.categoryKind || c.kind === a.categoryKind)
    return {
      period: a.period, from: range.from, to: range.to,
      totalCents: a.categoryKind ? byCategory.reduce((s, c) => s + c.cents, 0) : o.totalCents,
      byCategory,
    }
  },

  async reminders(userId) {
    return (await listReminders(userId))
      .filter((r) => !r.doneAt)
      .sort((x, y) => x.dueOn.localeCompare(y.dueOn))
      .map((r) => ({ id: r.id, title: r.title, dueOn: r.dueOn, bikeName: r.bikeName, repeatYearly: r.repeatYearly }))
  },
}

let seq = 0

/** Runs one read-only tool for `userId`. Unknown ids answer `{ error: 'not found' }`, never throw. */
export async function runTool(userId: string, name: string, args: unknown, now = new Date()): Promise<{ ref: string; result: unknown }> {
  const ref = `${name}#${++seq}`
  const h = Object.hasOwn(handlers, name) ? handlers[name] : undefined
  if (!h) return { ref, result: { error: 'unknown tool' } }
  const a = typeof args === 'object' && args !== null && !Array.isArray(args) ? (args as Args) : {}
  return { ref, result: await h(userId, a, now) }
}

