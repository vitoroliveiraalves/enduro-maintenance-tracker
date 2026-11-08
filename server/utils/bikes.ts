import { and, asc, desc, eq, isNull } from 'drizzle-orm'
import { createError } from 'h3'
import { db } from '../db/client'
import { bikes, maintenanceItems, meterReadings, serviceItems, services } from '../db/schema'
import type { Bike, ConditionMultipliers, MaintenanceItem } from '../db/schema'
import { computeStatus, pickLastDone, sortByUrgency } from '../domain/maintenance-status'
import type { ItemDef, Reading } from '../domain/maintenance-status'
import type { BikeSummary, ItemRow } from '../domain/item-row'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DATE = /^\d{4}-\d{2}-\d{2}$/
export const bad = (msg: string) => createError({ statusCode: 400, statusMessage: msg })

export type ItemInput = {
  name: string
  everyHoursTenths?: number | null
  everyKm?: number | null
  everyMonths?: number | null
  conditionMultipliers?: ConditionMultipliers
  lastDone?: { at: string; hoursTenths?: number | null; km?: number | null } | null
}

export type BikeInput = {
  clientId: string
  name: string
  make: string
  model: string
  year: number
  stroke: '2T' | '4T'
  hoursTenths: number
  km: number
  items: ItemInput[]
}

export type Obj = Record<string, unknown>
export const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)

export function str(v: unknown, field: string, max = 80): string {
  if (typeof v !== 'string' || !v.trim() || v.trim().length > max) throw bad(`Invalid ${field}`)
  return v.trim()
}
export function int(v: unknown, field: string, min = 0, max = 10_000_000): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) throw bad(`Invalid ${field}`)
  return v
}
export function optInt(v: unknown, field: string, min = 0): number | null {
  return v === undefined || v === null ? null : int(v, field, min)
}
/** A calendar day "YYYY-MM-DD" that really exists and is not in the future (1 day of slack for timezones). */
export function cleanDate(v: unknown, label: string): string {
  if (typeof v !== 'string') throw bad(`Invalid ${label} date`)
  const at = v.slice(0, 10)
  const parsedAt = new Date(`${at}T00:00:00Z`)
  if (!DATE.test(at) || Number.isNaN(parsedAt.getTime()) || parsedAt.toISOString().slice(0, 10) !== at) {
    throw bad(`Invalid ${label} date`)
  }
  if (at > new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)) throw bad(`${label === 'lastDone' ? 'Last done' : 'The'} date is in the future`)
  return at
}

/** Throws 400 when hours/km are above the bike's current meters. */
export function assertNotAboveMeters(
  what: string,
  done: { hoursTenths?: number | null; km?: number | null },
  current: { hoursTenths: number; km: number },
) {
  if (done.hoursTenths != null && done.hoursTenths > current.hoursTenths) {
    throw bad(`${what}: ${(done.hoursTenths / 10).toFixed(1)} h is more than the bike's current ${(current.hoursTenths / 10).toFixed(1)} h`)
  }
  if (done.km != null && done.km > current.km) {
    throw bad(`${what}: ${done.km} km is more than the bike's current ${current.km} km`)
  }
}

export function uuid(v: unknown, field = 'clientId'): string {
  if (typeof v !== 'string' || !UUID.test(v)) throw bad(`Invalid ${field}`)
  return v
}

const MULTIPLIER_KEYS = ['mud', 'sand', 'dust', 'race'] as const
function multipliers(v: unknown): ConditionMultipliers {
  if (v === undefined || v === null) return {}
  if (!isObj(v)) throw bad('Invalid conditionMultipliers')
  const out: ConditionMultipliers = {}
  for (const k of MULTIPLIER_KEYS) {
    const n = v[k]
    if (n === undefined) continue
    if (typeof n !== 'number' || !(n >= 0.1 && n <= 10)) throw bad('Invalid conditionMultipliers')
    out[k] = n
  }
  return out
}

type Intervals = { everyHoursTenths: number | null; everyKm: number | null; everyMonths: number | null }
function intervals(o: Obj): Intervals {
  const r = {
    everyHoursTenths: optInt(o.everyHoursTenths, 'everyHoursTenths', 1),
    everyKm: optInt(o.everyKm, 'everyKm', 1),
    everyMonths: optInt(o.everyMonths, 'everyMonths', 1),
  }
  if (r.everyHoursTenths === null && r.everyKm === null && r.everyMonths === null) {
    throw bad('An item needs at least one interval')
  }
  return r
}

type CleanItem = { name: string; conditionMultipliers: ConditionMultipliers; lastDone: { at: string; hoursTenths: number | null; km: number | null } | null } & Intervals

function cleanItem(raw: unknown): CleanItem {
  if (!isObj(raw)) throw bad('Invalid item')
  let lastDone: CleanItem['lastDone'] = null
  if (raw.lastDone !== undefined && raw.lastDone !== null) {
    const l = raw.lastDone
    if (!isObj(l) || typeof l.at !== 'string') throw bad('Invalid lastDone')
    const at = cleanDate(l.at, 'lastDone')
    lastDone = { at, hoursTenths: optInt(l.hoursTenths, 'lastDone hours'), km: optInt(l.km, 'lastDone km') }
  }
  return { name: str(raw.name, 'item name'), conditionMultipliers: multipliers(raw.conditionMultipliers), ...intervals(raw), lastDone }
}

export function parseBikeInput(raw: unknown) {
  if (!isObj(raw)) throw bad('Invalid body')
  if (raw.stroke !== '2T' && raw.stroke !== '4T') throw bad('Invalid stroke')
  if (!Array.isArray(raw.items) || raw.items.length > 80) throw bad('Invalid items')
  const parsed = {
    clientId: uuid(raw.clientId),
    name: str(raw.name, 'name'),
    make: str(raw.make, 'make'),
    model: str(raw.model, 'model'),
    year: int(raw.year, 'year', 1950, 2100),
    stroke: raw.stroke as '2T' | '4T',
    hoursTenths: int(raw.hoursTenths, 'hoursTenths'),
    km: int(raw.km, 'km'),
    items: raw.items.map(cleanItem),
  }
  for (const it of parsed.items) {
    if (it.lastDone) assertNotAboveMeters(it.name, it.lastDone, parsed)
  }
  return parsed
}

/**
 * Bike + initial reading + items + "Initial" services in one transaction.
 * A replayed clientId returns the existing bike and creates nothing.
 */
export async function createBike(userId: string, raw: unknown): Promise<Bike> {
  const input = parseBikeInput(raw)
  return db.transaction(async (tx) => {
    const [bike] = await tx
      .insert(bikes)
      .values({ userId, clientId: input.clientId, name: input.name, make: input.make, model: input.model, year: input.year, stroke: input.stroke })
      .onConflictDoNothing({ target: [bikes.userId, bikes.clientId] })
      .returning()
    if (!bike) {
      const [existing] = await tx.select().from(bikes).where(and(eq(bikes.userId, userId), eq(bikes.clientId, input.clientId)))
      return existing!
    }
    await tx.insert(meterReadings).values({ bikeId: bike.id, userId, hoursTenths: input.hoursTenths, km: input.km })
    for (const [i, it] of input.items.entries()) {
      const [item] = await tx
        .insert(maintenanceItems)
        .values({
          bikeId: bike.id,
          userId,
          name: it.name,
          everyHoursTenths: it.everyHoursTenths,
          everyKm: it.everyKm,
          everyMonths: it.everyMonths,
          conditionMultipliers: it.conditionMultipliers,
          sortOrder: i,
        })
        .returning({ id: maintenanceItems.id })
      if (it.lastDone) {
        const [svc] = await tx
          .insert(services)
          .values({ bikeId: bike.id, userId, at: it.lastDone.at, hoursTenths: it.lastDone.hoursTenths, km: it.lastDone.km, by: 'diy', notes: 'Initial' })
          .returning({ id: services.id })
        await tx.insert(serviceItems).values({ serviceId: svc!.id, itemId: item!.id })
      }
    }
    return bike
  })
}

const defOf = (i: MaintenanceItem): ItemDef => ({
  ...(i.everyHoursTenths ? { everyHoursTenths: i.everyHoursTenths } : {}),
  ...(i.everyKm ? { everyKm: i.everyKm } : {}),
  ...(i.everyMonths ? { everyMonths: i.everyMonths } : {}),
  conditionMultipliers: i.conditionMultipliers,
})

export async function latestReading(bikeId: string, userId: string) {
  const [r] = await db
    .select()
    .from(meterReadings)
    .where(and(eq(meterReadings.bikeId, bikeId), eq(meterReadings.userId, userId)))
    .orderBy(desc(meterReadings.at), desc(meterReadings.hoursTenths))
    .limit(1)
  return r ?? null
}

/** Active items of a bike with last-done and status, most urgent first. */
export async function itemRows(bikeId: string, userId: string, now = new Date()): Promise<ItemRow[]> {
  const items = await db
    .select()
    .from(maintenanceItems)
    .where(and(eq(maintenanceItems.bikeId, bikeId), eq(maintenanceItems.userId, userId), isNull(maintenanceItems.archivedAt)))
    .orderBy(asc(maintenanceItems.sortOrder), asc(maintenanceItems.createdAt))
  const svcRows = await db
    .select({ itemId: serviceItems.itemId, s: services })
    .from(serviceItems)
    .innerJoin(services, eq(serviceItems.serviceId, services.id))
    .where(and(eq(services.bikeId, bikeId), eq(services.userId, userId)))
  const readings: Reading[] = (
    await db.select().from(meterReadings).where(and(eq(meterReadings.bikeId, bikeId), eq(meterReadings.userId, userId)))
  ).map((r) => ({ at: r.at, hoursTenths: r.hoursTenths, km: r.km, condition: r.condition }))

  const rows = items.map((item): ItemRow => {
    const list = svcRows
      .filter((x) => x.itemId === item.id)
      .map(({ s }) => ({
        at: new Date(s.at),
        ...(s.hoursTenths !== null ? { hoursTenths: s.hoursTenths } : {}),
        ...(s.km !== null ? { km: s.km } : {}),
        by: s.by,
        garageName: s.garageName ?? undefined,
      }))
    const picked = pickLastDone(list)
    const src = picked && list.find((s) => s.at.getTime() === picked.at.getTime() && s.hoursTenths === picked.hoursTenths && s.km === picked.km)
    const last = picked && src ? { ...picked, by: src.by, ...(src.garageName ? { garageName: src.garageName } : {}) } : null
    const def = defOf(item)
    return { id: item.id, name: item.name, def, last, status: computeStatus(def, picked, readings, now) }
  })
  return sortByUrgency(rows)
}

export async function bikeDetail(bike: Bike) {
  return { bike, latestReading: await latestReading(bike.id, bike.userId), items: await itemRows(bike.id, bike.userId) }
}

export async function listBikes(userId: string): Promise<BikeSummary[]> {
  const list = await db
    .select()
    .from(bikes)
    .where(and(eq(bikes.userId, userId), isNull(bikes.archivedAt)))
    .orderBy(asc(bikes.createdAt))
  return Promise.all(
    list.map(async (b) => {
      const [rd, rows] = await Promise.all([latestReading(b.id, userId), itemRows(b.id, userId)])
      return {
        id: b.id,
        name: b.name,
        year: b.year,
        latestReading: rd ? { at: rd.at.toISOString(), hoursTenths: rd.hoursTenths, km: rd.km } : null,
        counts: {
          overdue: rows.filter((r) => r.status.state === 'overdue').length,
          soon: rows.filter((r) => r.status.state === 'soon').length,
        },
      }
    }),
  )
}

export async function patchBike(bike: Bike, raw: unknown): Promise<Bike> {
  if (!isObj(raw)) throw bad('Invalid body')
  const set: Partial<typeof bikes.$inferInsert> = {}
  if (raw.name !== undefined) set.name = str(raw.name, 'name')
  if (raw.make !== undefined) set.make = str(raw.make, 'make')
  if (raw.model !== undefined) set.model = str(raw.model, 'model')
  if (raw.year !== undefined) set.year = int(raw.year, 'year', 1950, 2100)
  if (raw.archived !== undefined) set.archivedAt = raw.archived ? new Date() : null
  if (Object.keys(set).length === 0) return bike
  const [row] = await db.update(bikes).set(set).where(and(eq(bikes.id, bike.id), eq(bikes.userId, bike.userId))).returning()
  return row!
}

/** Create one item (idempotent on clientId). `bike` must already be ownership-checked. */
export async function createItem(bike: Bike, raw: unknown): Promise<MaintenanceItem> {
  if (!isObj(raw)) throw bad('Invalid body')
  const clientId = uuid(raw.clientId)
  const item = cleanItem(raw)
  const [row] = await db
    .insert(maintenanceItems)
    .values({
      bikeId: bike.id,
      userId: bike.userId,
      clientId,
      name: item.name,
      everyHoursTenths: item.everyHoursTenths,
      everyKm: item.everyKm,
      everyMonths: item.everyMonths,
      conditionMultipliers: item.conditionMultipliers,
      sortOrder: 1000,
    })
    .onConflictDoNothing({ target: [maintenanceItems.userId, maintenanceItems.clientId] })
    .returning()
  if (row) return row
  const [existing] = await db
    .select()
    .from(maintenanceItems)
    .where(and(eq(maintenanceItems.userId, bike.userId), eq(maintenanceItems.clientId, clientId)))
  return existing!
}

export async function patchItem(item: MaintenanceItem, userId: string, raw: unknown): Promise<MaintenanceItem> {
  if (!isObj(raw)) throw bad('Invalid body')
  const set: Partial<typeof maintenanceItems.$inferInsert> = {}
  if (raw.name !== undefined) set.name = str(raw.name, 'item name')
  if ('everyHoursTenths' in raw || 'everyKm' in raw || 'everyMonths' in raw) {
    const merged = intervals({
      everyHoursTenths: 'everyHoursTenths' in raw ? raw.everyHoursTenths : item.everyHoursTenths,
      everyKm: 'everyKm' in raw ? raw.everyKm : item.everyKm,
      everyMonths: 'everyMonths' in raw ? raw.everyMonths : item.everyMonths,
    })
    Object.assign(set, merged)
  }
  if (raw.conditionMultipliers !== undefined) set.conditionMultipliers = multipliers(raw.conditionMultipliers)
  if (raw.archived !== undefined) set.archivedAt = raw.archived ? new Date() : null
  if (Object.keys(set).length === 0) return item
  const [row] = await db
    .update(maintenanceItems)
    .set(set)
    .where(and(eq(maintenanceItems.id, item.id), eq(maintenanceItems.userId, userId)))
    .returning()
  return row!
}
