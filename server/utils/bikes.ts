import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm'
import { db } from '../db/client'
import { bikes, maintenanceItems, meterReadings, partItems, parts, serviceItems, services } from '../db/schema'
import type { Bike, ConditionMultipliers, MaintenanceItem } from '../db/schema'
import { computeStatus, pickLastDone, sortByUrgency } from '../domain/maintenance-status'
import type { ItemDef, Reading } from '../domain/maintenance-status'
import type { BikeSummary, ItemRow } from '../domain/item-row'
import { bad, day, int, MAX_YEAR, uuid } from './validate'
import { countedDef, countsHours, countsKm, isBikeMeters, keepCounted } from '../../shared/utils/meters'
import type { BikeMeters } from '../../shared/utils/meters'

export type ItemInput = {
  name: string
  everyHoursTenths?: number | null
  everyKm?: number | null
  everyMonths?: number | null
  conditionMultipliers?: ConditionMultipliers
  lastDone?: { at?: string | null; hoursTenths?: number | null; km?: number | null } | null
}

export type BikeInput = {
  clientId: string
  name: string
  make: string
  model: string
  year: number
  stroke: '2T' | '4T'
  meters?: BikeMeters
  hoursTenths?: number
  km?: number
  items: ItemInput[]
}

export type Obj = Record<string, unknown>
export const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)

export function str(v: unknown, field: string, max = 80): string {
  if (typeof v !== 'string' || !v.trim() || v.trim().length > max) throw bad(`Invalid ${field}`)
  return v.trim()
}
export function optInt(v: unknown, field: string, min = 0): number | null {
  return v === undefined || v === null ? null : int(v, field, min)
}
/** A calendar day "YYYY-MM-DD" (a longer ISO string is cut to its day) — see `day()` in validate.ts. */
export function realDate(v: unknown, label: string): string {
  return day(typeof v === 'string' ? v.slice(0, 10) : v, `${label} date`)
}

/** A real calendar day that is not in the future (1 day of slack for timezones). */
export function cleanDate(v: unknown, label: string): string {
  const future = () => bad(`${label === 'lastDone' ? 'Last done' : 'The'} date is in the future`)
  // Past MAX_YEAR is still "in the future" to the rider, not "invalid".
  if (typeof v === 'string' && /^\d{4}-/.test(v) && Number(v.slice(0, 4)) > MAX_YEAR) throw future()
  const at = realDate(v, label)
  if (at > new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)) throw future()
  return at
}

/** The optional hours/km of a write, parsed only for the meters the bike counts (an uncounted one is ignored, stored null). */
export function countedMeters(meters: BikeMeters, o: Obj): { hoursTenths: number | null; km: number | null } {
  return keepCounted(meters, {
    hoursTenths: countsHours(meters) ? optInt(o.hoursTenths, 'hoursTenths') : null,
    km: countsKm(meters) ? optInt(o.km, 'km') : null,
  })
}

/** Newest reading first; a reading without hours sorts after one with them. */
export const hoursDesc = sql`${meterReadings.hoursTenths} desc nulls last`
export const hoursAsc = sql`${meterReadings.hoursTenths} asc nulls last`

/** Throws 400 when hours/km are above the bike's current meters. */
export function assertNotAboveMeters(
  what: string,
  done: { hoursTenths?: number | null; km?: number | null },
  current: { hoursTenths: number | null; km: number | null },
) {
  if (done.hoursTenths != null && current.hoursTenths !== null && done.hoursTenths > current.hoursTenths) {
    throw bad(`${what}: ${(done.hoursTenths / 10).toFixed(1)} h is more than the bike's current ${(current.hoursTenths / 10).toFixed(1)} h`)
  }
  if (done.km != null && current.km !== null && done.km > current.km) {
    throw bad(`${what}: ${done.km} km is more than the bike's current ${current.km} km`)
  }
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
function intervals(o: Obj, meters: BikeMeters = 'hours_km'): Intervals {
  const r = {
    everyHoursTenths: countsHours(meters) ? optInt(o.everyHoursTenths, 'everyHoursTenths', 1) : null,
    everyKm: countsKm(meters) ? optInt(o.everyKm, 'everyKm', 1) : null,
    everyMonths: optInt(o.everyMonths, 'everyMonths', 1),
  }
  if (r.everyHoursTenths === null && r.everyKm === null && r.everyMonths === null) {
    throw bad('An item needs at least one interval')
  }
  return r
}

type CleanItem = { name: string; conditionMultipliers: ConditionMultipliers; lastDone: { at: string; atUnknown: boolean; hoursTenths: number | null; km: number | null } | null } & Intervals

function cleanItem(raw: unknown, meters: BikeMeters): CleanItem {
  if (!isObj(raw)) throw bad('Invalid item')
  let lastDone: CleanItem['lastDone'] = null
  if (raw.lastDone !== undefined && raw.lastDone !== null) {
    const l = raw.lastDone
    if (!isObj(l)) throw bad('Invalid lastDone')
    const sent = l.hoursTenths != null || l.km != null
    const hoursTenths = countsHours(meters) ? optInt(l.hoursTenths, 'lastDone hours') : null
    const km = countsKm(meters) ? optInt(l.km, 'lastDone km') : null
    if (l.at === undefined || l.at === null || l.at === '') {
      // Meters known, date not: keep the set-up day as a placeholder, flagged, never shown as a date.
      if (hoursTenths === null && km === null) {
        // Only uncounted meters were sent: nothing to record (ignored, not a 400).
        if (!sent) throw bad('Invalid lastDone')
      } else {
        lastDone = { at: new Date().toISOString().slice(0, 10), atUnknown: true, hoursTenths, km }
      }
    } else {
      lastDone = { at: cleanDate(l.at, 'lastDone'), atUnknown: false, hoursTenths, km }
    }
  }
  return { name: str(raw.name, 'item name'), conditionMultipliers: multipliers(raw.conditionMultipliers), ...intervals(raw, meters), lastDone }
}

export function parseBikeInput(raw: unknown) {
  if (!isObj(raw)) throw bad('Invalid body')
  if (raw.stroke !== '2T' && raw.stroke !== '4T') throw bad('Invalid stroke')
  if (!Array.isArray(raw.items) || raw.items.length > 80) throw bad('Invalid items')
  if (raw.meters !== undefined && !isBikeMeters(raw.meters)) throw bad('Invalid meters')
  const meters: BikeMeters = raw.meters ?? 'hours_km'
  const parsed = {
    clientId: uuid(raw.clientId),
    name: str(raw.name, 'name'),
    make: str(raw.make, 'make'),
    model: str(raw.model, 'model'),
    year: int(raw.year, 'year', 1950, 2100),
    stroke: raw.stroke as '2T' | '4T',
    meters,
    hoursTenths: countsHours(meters) ? int(raw.hoursTenths, 'hoursTenths') : null,
    km: countsKm(meters) ? int(raw.km, 'km') : null,
    items: raw.items.map((i) => cleanItem(i, meters)),
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
      .values({ userId, clientId: input.clientId, name: input.name, make: input.make, model: input.model, year: input.year, stroke: input.stroke, meters: input.meters })
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
          .values({ bikeId: bike.id, userId, at: it.lastDone.at, atUnknown: it.lastDone.atUnknown, hoursTenths: it.lastDone.hoursTenths, km: it.lastDone.km, by: 'diy', notes: 'Initial' })
          .returning({ id: services.id })
        await tx.insert(serviceItems).values({ serviceId: svc!.id, itemId: item!.id })
      }
    }
    return bike
  })
}

/** The item's intervals as stored; status goes through `countedDef` for the bike's meters. */
const defOf = (i: MaintenanceItem, meters: BikeMeters): ItemDef => countedDef(meters, {
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
    .orderBy(desc(meterReadings.at), hoursDesc)
    .limit(1)
  return r ?? null
}

/** Active items of a bike with last-done and status, most urgent first. */
export async function itemRows(bikeId: string, userId: string, now = new Date()): Promise<ItemRow[]> {
  const [bike] = await db.select({ meters: bikes.meters }).from(bikes).where(and(eq(bikes.id, bikeId), eq(bikes.userId, userId)))
  const meters = bike?.meters ?? 'hours_km'
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

  const links = await db
    .select({ itemId: partItems.itemId, qty: parts.qtyHundredths })
    .from(partItems)
    .innerJoin(parts, eq(partItems.partId, parts.id))
    .innerJoin(maintenanceItems, eq(partItems.itemId, maintenanceItems.id))
    .where(and(eq(parts.userId, userId), eq(maintenanceItems.bikeId, bikeId), eq(maintenanceItems.userId, userId)))
  const stockOf = (itemId: string): ItemRow['stock'] => {
    const mine = links.filter((l) => l.itemId === itemId)
    return !mine.length ? null : mine.some((l) => l.qty <= 0) ? 'none' : 'in'
  }

  const rows = items.map((item): ItemRow => {
    const list = svcRows
      .filter((x) => x.itemId === item.id)
      .map(({ s }) => ({
        id: s.id,
        at: new Date(s.at),
        ...(s.atUnknown ? { dateUnknown: true } : {}),
        ...(s.hoursTenths !== null ? { hoursTenths: s.hoursTenths } : {}),
        ...(s.km !== null ? { km: s.km } : {}),
        by: s.by,
        garageName: s.garageName ?? undefined,
      }))
    const picked = pickLastDone(list, readings)
    const src = picked && list.find((s) => s.at.getTime() === picked.at.getTime() && s.hoursTenths === picked.hoursTenths && s.km === picked.km)
    const last = picked && src ? { ...picked, serviceId: src.id, by: src.by, ...(src.garageName ? { garageName: src.garageName } : {}) } : null
    const def = defOf(item, meters)
    return { id: item.id, name: item.name, def, last, status: computeStatus(def, picked, readings, now), stock: stockOf(item.id) }
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
        make: b.make,
        model: b.model,
        year: b.year,
        meters: b.meters,
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
  if (raw.meters !== undefined) {
    if (!isBikeMeters(raw.meters)) throw bad('Invalid meters')
    set.meters = raw.meters
  }
  if (raw.archived !== undefined) set.archivedAt = raw.archived ? new Date() : null
  if (Object.keys(set).length === 0) return bike
  const [row] = await db.update(bikes).set(set).where(and(eq(bikes.id, bike.id), eq(bikes.userId, bike.userId))).returning()
  return row!
}

/** Create one item (idempotent on clientId). `bike` must already be ownership-checked. */
export async function createItem(bike: Bike, raw: unknown): Promise<MaintenanceItem> {
  if (!isObj(raw)) throw bad('Invalid body')
  const clientId = uuid(raw.clientId)
  const item = cleanItem(raw, bike.meters)
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
    // An uncounted unit in the body is ignored: its stored interval stays (switching back is lossless).
    const [bike] = await db.select({ meters: bikes.meters }).from(bikes).where(and(eq(bikes.id, item.bikeId), eq(bikes.userId, userId)))
    const meters = bike?.meters ?? 'hours_km'
    const merged = intervals({
      everyHoursTenths: 'everyHoursTenths' in raw && countsHours(meters) ? raw.everyHoursTenths : item.everyHoursTenths,
      everyKm: 'everyKm' in raw && countsKm(meters) ? raw.everyKm : item.everyKm,
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
