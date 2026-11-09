import { keepCounted } from '../../shared/utils/meters'
import { and, desc, eq, inArray, isNull, lt, sql } from 'drizzle-orm'
import { db } from '../db/client'
import { bikes, expenseItems, expenses, maintenanceItems, meterReadings, partMovements, parts, serviceItems, services } from '../db/schema'
import type { Bike, Service } from '../db/schema'
import { assertNotAboveMeters, bikeDetail, cleanDate, countedMeters, hoursDesc, isObj, latestReading, str } from './bikes'
import { bad, uuid } from './validate'
import { applyMovement, qty } from './parts'
import { amountCents, checkCategory, checkDocument, checkItemIds, description } from './expenses'
import type { Tx } from './expenses'

const MAX_EXPENSES = 20
const MAX_PARTS_USED = 20

interface PartUse {
  clientId: string
  partId: string
  qtyHundredths: number
  partName: string | null
}

/** Validate `partsUsed` (≤ 20 lines; a part or a movement clientId may appear once). */
function partUses(v: unknown): PartUse[] {
  if (v === undefined || v === null) return []
  if (!Array.isArray(v) || v.length > MAX_PARTS_USED) throw bad('Invalid partsUsed')
  const lines = v.map((l): PartUse => {
    if (!isObj(l)) throw bad('Invalid partsUsed')
    return {
      clientId: uuid(l.clientId, 'partsUsed clientId'),
      partId: uuid(l.partId, 'partsUsed partId'),
      qtyHundredths: qty(l.qtyHundredths, 'partsUsed qtyHundredths'),
      partName: l.partName == null ? null : str(l.partName, 'partName', 80),
    }
  })
  if (lines.some((l) => l.qtyHundredths <= 0)) throw bad('Invalid partsUsed qtyHundredths')
  if (new Set(lines.map((l) => l.partId)).size !== lines.length || new Set(lines.map((l) => l.clientId)).size !== lines.length) {
    throw bad('Duplicate partsUsed line')
  }
  return lines
}

/**
 * Log a service that resets `itemIds` (and optionally books costs against it).
 * `bike` must already be ownership-checked. A replayed clientId creates nothing.
 */
export async function createService(bike: Bike, raw: unknown) {
  await db.transaction((tx) => insertService(bike, raw, tx))
  return bikeDetail(bike)
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * A service can't have more hours/km than the bike had on its day: the latest
 * reading on or before `at` caps it (a later reading must not make a backdated
 * service look fresher — Review Focus 2). No reading by then → nothing to check.
 */
export async function assertNotAboveMetersOn(bike: Bike, at: string, done: { hoursTenths: number | null; km: number | null }, t: Tx = db) {
  if (done.hoursTenths == null && done.km == null) return
  const endOfDay = new Date(new Date(`${at}T00:00:00Z`).getTime() + 86_400_000)
  const [r] = await t
    .select()
    .from(meterReadings)
    .where(and(eq(meterReadings.bikeId, bike.id), eq(meterReadings.userId, bike.userId), lt(meterReadings.at, endOfDay)))
    .orderBy(desc(meterReadings.at), hoursDesc)
    .limit(1)
  if (!r) return
  const on = `On ${r.at.getUTCDate()} ${MONTHS[r.at.getUTCMonth()]}`
  if (done.hoursTenths != null && r.hoursTenths !== null && done.hoursTenths > r.hoursTenths) {
    throw bad(`${on} the bike had ${(r.hoursTenths / 10).toFixed(1)} h — the service can't be at ${(done.hoursTenths / 10).toFixed(1)} h`)
  }
  if (done.km != null && r.km !== null && done.km > r.km) throw bad(`${on} the bike had ${r.km} km — the service can't be at ${done.km} km`)
}

/**
 * Validate and write one service inside `tx` (also used by invoice confirm).
 * Returns the new service id, or null when the clientId was already used.
 */
export async function insertService(bike: Bike, raw: unknown, tx: Tx): Promise<string | null> {
  if (!isObj(raw)) throw bad('Invalid body')
  const clientId = uuid(raw.clientId)
  const userId = bike.userId

  const [existing] = await tx.select({ id: services.id }).from(services).where(and(eq(services.userId, userId), eq(services.clientId, clientId)))
  if (existing) return null

  const at = cleanDate(raw.at, 'service')
  const { hoursTenths, km } = countedMeters(bike.meters, raw)
  const current = await latestReading(bike.id, userId)
  if (current) assertNotAboveMeters('Service', { hoursTenths, km }, current)
  await assertNotAboveMetersOn(bike, at, { hoursTenths, km }, tx)
  if (raw.by !== 'diy' && raw.by !== 'garage') throw bad('Invalid by')
  const garageName = raw.by === 'garage' && raw.garageName != null && raw.garageName !== '' ? str(raw.garageName, 'garageName') : null
  const notes = raw.notes == null || raw.notes === '' ? null : str(raw.notes, 'notes', 500)
  const rawExpenses = raw.expenses ?? []
  if (!Array.isArray(rawExpenses) || rawExpenses.length > MAX_EXPENSES) throw bad('Invalid expenses')

  const uses = partUses(raw.partsUsed)
  const itemIds = await checkItemIds(bike, raw.itemIds, { min: 1 }, tx)
  const documentId = await checkDocument(userId, raw.documentId, tx)
  const costs = []
  for (const e of rawExpenses) {
    if (!isObj(e)) throw bad('Invalid expenses')
    costs.push({ amountCents: amountCents(e.amountCents), categoryId: await checkCategory(userId, e.categoryId, tx), description: description(e.description) })
  }
  const [svc] = await tx
    .insert(services)
    .values({ bikeId: bike.id, userId, clientId, at, hoursTenths, km, by: raw.by as 'diy' | 'garage', garageName, notes, documentId })
    .onConflictDoNothing({ target: [services.userId, services.clientId] })
    .returning({ id: services.id })
  if (!svc) return null // lost a race with a replay of the same clientId
  await tx.insert(serviceItems).values(itemIds.map((itemId) => ({ serviceId: svc.id, itemId })))
  for (const c of costs) {
    const [exp] = await tx
      .insert(expenses)
      .values({ userId, bikeId: bike.id, at, serviceId: svc.id, documentId, ...c })
      .returning({ id: expenses.id })
    await tx.insert(expenseItems).values(itemIds.map((itemId) => ({ expenseId: exp!.id, itemId })))
  }
  if (uses.length) {
    const found = await tx.select().from(parts).where(and(eq(parts.userId, userId), inArray(parts.id, uses.map((u) => u.partId))))
    for (const u of uses) {
      const part = found.find((p) => p.id === u.partId) ?? null
      await applyMovement(tx, {
        userId, clientId: u.clientId, part,
        partName: part?.name ?? u.partName ?? 'Removed part', unit: part?.unit ?? 'pcs',
        kind: 'used', qtyHundredths: -u.qtyHundredths, at, serviceId: svc.id,
      })
    }
  }
  return svc.id
}

/**
 * Delete a service and its item links. Costs booked on it go too, except those
 * that came from an invoice: they stay (the invoice still exists), unlinked.
 */
export async function deleteService(service: Service) {
  const own = and(eq(expenses.serviceId, service.id), eq(expenses.userId, service.userId))
  await db.transaction(async (tx) => {
    // Give the used parts back.
    // Deleting them first (and restoring only what came back) makes a concurrent delete restore nothing twice.
    const used = await tx
      .delete(partMovements)
      .where(and(eq(partMovements.serviceId, service.id), eq(partMovements.userId, service.userId), eq(partMovements.kind, 'used')))
      .returning({ partId: partMovements.partId, qty: partMovements.qtyHundredths })
    for (const m of used) {
      if (!m.partId) continue
      await tx
        .update(parts)
        .set({ qtyHundredths: sql`${parts.qtyHundredths} - ${m.qty}` })
        .where(and(eq(parts.id, m.partId), eq(parts.userId, service.userId)))
    }
    await tx.delete(expenses).where(and(own, isNull(expenses.documentId)))
    await tx.update(expenses).set({ serviceId: null }).where(own)
    await tx.delete(services).where(and(eq(services.id, service.id), eq(services.userId, service.userId)))
  })
  const [bike] = await db.select().from(bikes).where(and(eq(bikes.id, service.bikeId), eq(bikes.userId, service.userId)))
  return bikeDetail(bike!)
}

export async function listServices(userId: string, f: { bikeId?: string } = {}) {
  const rows = await db
    .select({ s: services, bikeName: bikes.name, meters: bikes.meters })
    .from(services)
    .innerJoin(bikes, eq(services.bikeId, bikes.id))
    .where(and(eq(services.userId, userId), f.bikeId ? eq(services.bikeId, f.bikeId) : undefined))
    .orderBy(desc(services.at), desc(services.createdAt))
  if (!rows.length) return []
  const ids = rows.map((r) => r.s.id)
  const items = await db
    .select({ serviceId: serviceItems.serviceId, name: maintenanceItems.name })
    .from(serviceItems)
    .innerJoin(maintenanceItems, eq(serviceItems.itemId, maintenanceItems.id))
    .where(inArray(serviceItems.serviceId, ids))
  const totals = await db
    .select({ serviceId: expenses.serviceId, total: sql<number>`sum(${expenses.amountCents})::int` })
    .from(expenses)
    .where(and(eq(expenses.userId, userId), inArray(expenses.serviceId, ids)))
    .groupBy(expenses.serviceId)
  const used = await partsUsedBy(userId, ids)
  // Stored meters of a unit the bike no longer counts stay in the database, hidden here.
  return rows.map(({ s, bikeName, meters }) => ({
    id: s.id,
    bikeId: s.bikeId,
    bikeName,
    at: s.at,
    atUnknown: s.atUnknown,
    ...keepCounted(meters, s),
    by: s.by,
    garageName: s.garageName,
    notes: s.notes,
    documentId: s.documentId,
    itemNames: items.filter((i) => i.serviceId === s.id).map((i) => i.name),
    totalCents: totals.find((t) => t.serviceId === s.id)?.total ?? 0,
    partsUsed: used.get(s.id) ?? [],
  }))
}

export interface PartUsed {
  name: string
  qtyHundredths: number
  unit: string
}

/** Parts used per service id, from the movements' snapshot (positive = amount used). */
export async function partsUsedBy(userId: string, serviceIds: string[]): Promise<Map<string, PartUsed[]>> {
  const out = new Map<string, PartUsed[]>()
  if (!serviceIds.length) return out
  const rows = await db
    .select({ serviceId: partMovements.serviceId, name: partMovements.partName, q: partMovements.qtyHundredths, unit: partMovements.unit })
    .from(partMovements)
    .where(and(eq(partMovements.userId, userId), eq(partMovements.kind, 'used'), inArray(partMovements.serviceId, serviceIds)))
    .orderBy(partMovements.createdAt, partMovements.id)
  for (const r of rows) {
    const list = out.get(r.serviceId!) ?? []
    list.push({ name: r.name, qtyHundredths: -r.q, unit: r.unit })
    out.set(r.serviceId!, list)
  }
  return out
}
