import { and, desc, eq, inArray, isNull, lte, sql } from 'drizzle-orm'
import { createError } from 'h3'
import { db } from '../db/client'
import { bikes, expenses, maintenanceItems, partItems, partMovements, parts, services, shoppingEntries } from '../db/schema'
import type { MovementKind, Part } from '../db/schema'
import type { Tx } from './expenses'
import { isObj, str } from './bikes'
import { bad, isInt, isUuid, uuid } from './validate'

/** ±10 000 units, in hundredths. */
const MAX_QTY = 1_000_000

/** Integer hundredths within ±10 000 units (negative only with `allowNegative`); 400 otherwise. */
export function qty(v: unknown, field: string, { allowNegative = false }: { allowNegative?: boolean } = {}): number {
  if (!isInt(v, allowNegative ? -MAX_QTY : 0, MAX_QTY)) throw bad(`Invalid ${field}`)
  return v
}

export interface MovementInput {
  userId: string
  clientId: string
  /** Trusted as-is: obtain it through `ownedPart` or a userId-scoped query, never from client input. */
  part: Part | null
  partName: string
  unit: string
  kind: MovementKind
  qtyHundredths: number
  at: string
  expenseId?: string
  documentId?: string
  serviceId?: string
  note?: string
}

/**
 * Record a movement and move the part's count by its signed quantity, in SQL
 * (never read-modify-write). Replaying a clientId changes nothing. A 'bought'
 * movement also ticks the part's open manual shopping entries.
 */
export async function applyMovement(tx: Tx, m: MovementInput): Promise<{ applied: boolean }> {
  const inserted = await tx
    .insert(partMovements)
    .values({
      userId: m.userId,
      clientId: m.clientId,
      partId: m.part?.id ?? null,
      partName: m.partName,
      unit: m.unit,
      kind: m.kind,
      qtyHundredths: m.qtyHundredths,
      at: m.at,
      expenseId: m.expenseId ?? null,
      documentId: m.documentId ?? null,
      serviceId: m.serviceId ?? null,
      note: m.note ?? null,
    })
    .onConflictDoNothing({ target: [partMovements.userId, partMovements.clientId] })
    .returning({ id: partMovements.id })
  if (!inserted.length) return { applied: false }
  if (!m.part) return { applied: true }

  await tx
    .update(parts)
    .set({ qtyHundredths: sql`${parts.qtyHundredths} + ${m.qtyHundredths}` })
    .where(and(eq(parts.id, m.part.id), eq(parts.userId, m.userId)))
  if (m.kind === 'bought') {
    await tx
      .update(shoppingEntries)
      .set({ doneAt: sql`now()` })
      .where(
        and(
          eq(shoppingEntries.userId, m.userId),
          eq(shoppingEntries.partId, m.part.id),
          isNull(shoppingEntries.doneAt),
          lte(shoppingEntries.createdAt, sql`now()`),
        ),
      )
  }
  return { applied: true }
}

export interface PartRow {
  id: string
  name: string
  unit: string
  qtyHundredths: number
  minHundredths: number | null
  notes: string | null
  bikeId: string | null
  bikeName: string | null
  itemIds: string[]
}

export interface PartHistoryRow {
  id: string
  kind: MovementKind
  qtyHundredths: number
  at: string
  note: string | null
  expenseId: string | null
  documentId: string | null
  serviceId: string | null
  unitCents: number | null
  garageName: string | null
}

const notFound = () => createError({ statusCode: 404, statusMessage: 'Not found' })
const MAX_ITEM_IDS = 200

function name(v: unknown) {
  return str(v, 'name', 80)
}
function unit(v: unknown) {
  return str(v, 'unit', 12)
}
function notes(v: unknown): string | null {
  if (v === null || v === undefined) return null
  if (typeof v !== 'string' || v.trim().length > 500) throw bad('Invalid notes')
  return v.trim() || null
}
function minQty(v: unknown): number | null {
  return v === null || v === undefined ? null : qty(v, 'minHundredths')
}
function bikeIdOf(v: unknown): string | null {
  if (v === null || v === undefined) return null
  if (typeof v !== 'string') throw bad('Invalid bikeId')
  if (v === '') throw bad('Invalid bikeId')
  return v
}

/** The user's bike, else 404 (a bad id can never match a row). */
async function checkBike(tx: Tx, userId: string, bikeId: string) {
  if (!isUuid(bikeId)) throw notFound()
  const [b] = await tx.select({ id: bikes.id }).from(bikes).where(and(eq(bikes.id, bikeId), eq(bikes.userId, userId)))
  if (!b) throw notFound()
}

/** Distinct item ids; each must be an item of the part's bike, or of any of the user's bikes when there is none. */
async function itemIdList(tx: Tx, userId: string, bikeId: string | null, v: unknown): Promise<string[]> {
  if (!Array.isArray(v) || v.length > MAX_ITEM_IDS) throw bad('Invalid itemIds')
  const ids = [...new Set(v.map((x) => uuid(x, 'itemIds')))]
  if (!ids.length) return ids
  const found = await tx
    .select({ id: maintenanceItems.id })
    .from(maintenanceItems)
    .innerJoin(bikes, eq(maintenanceItems.bikeId, bikes.id))
    .where(and(inArray(maintenanceItems.id, ids), eq(bikes.userId, userId), bikeId ? eq(bikes.id, bikeId) : undefined))
  if (found.length !== ids.length) throw bad('Invalid itemIds')
  return ids
}

/**
 * Create a part (+ its fit links and an optional starting count). A replayed
 * `clientId` returns the existing part; the starting movement is idempotent on
 * `startClientId`, so a replay adds nothing twice.
 */
export async function createPart(tx: Tx, userId: string, raw: unknown): Promise<Part> {
  if (!isObj(raw)) throw bad('Invalid body')
  const clientId = uuid(raw.clientId)
  const values = {
    userId,
    clientId,
    name: name(raw.name),
    unit: raw.unit === undefined ? 'pcs' : unit(raw.unit),
    bikeId: bikeIdOf(raw.bikeId),
    minHundredths: minQty(raw.minHundredths),
    notes: notes(raw.notes),
  }
  const items = raw.itemIds === undefined ? [] : raw.itemIds
  const start = raw.qtyHundredths === undefined || raw.qtyHundredths === null ? 0 : qty(raw.qtyHundredths, 'qtyHundredths')
  const startClientId = start > 0 ? uuid(raw.startClientId, 'startClientId') : null
  if (values.bikeId) await checkBike(tx, userId, values.bikeId)
  const itemIds = await itemIdList(tx, userId, values.bikeId, items)

  const [inserted] = await tx.insert(parts).values(values).onConflictDoNothing({ target: [parts.userId, parts.clientId] }).returning()
  let part = inserted
  if (!part) {
    ;[part] = await tx.select().from(parts).where(and(eq(parts.userId, userId), eq(parts.clientId, clientId)))
  } else if (itemIds.length) {
    await tx.insert(partItems).values(itemIds.map((itemId) => ({ partId: part!.id, itemId })))
  }
  if (startClientId) {
    await applyMovement(tx, { userId, clientId: startClientId, part: part!, partName: part!.name, unit: part!.unit, kind: 'adjust', qtyHundredths: start, at: new Date().toISOString().slice(0, 10) })
  }
  return part!
}

/** Edit a part's details and fit links; never touches the count. `part` must be ownership-checked. */
export async function patchPart(tx: Tx, userId: string, part: Part, raw: unknown): Promise<void> {
  if (!isObj(raw)) throw bad('Invalid body')
  const set: Partial<typeof parts.$inferInsert> = {}
  if (raw.name !== undefined) set.name = name(raw.name)
  if (raw.unit !== undefined) set.unit = unit(raw.unit)
  if (raw.minHundredths !== undefined) set.minHundredths = minQty(raw.minHundredths)
  if (raw.notes !== undefined) set.notes = notes(raw.notes)
  const bikeChanged = raw.bikeId !== undefined && bikeIdOf(raw.bikeId) !== part.bikeId
  const bikeId = raw.bikeId === undefined ? part.bikeId : bikeIdOf(raw.bikeId)
  if (raw.bikeId !== undefined) {
    if (bikeId) await checkBike(tx, userId, bikeId)
    set.bikeId = bikeId
  }
  const itemIds = raw.itemIds === undefined ? null : await itemIdList(tx, userId, bikeId, raw.itemIds)
  if (Object.keys(set).length) await tx.update(parts).set({ ...set, updatedAt: new Date() }).where(and(eq(parts.id, part.id), eq(parts.userId, userId)))
  if (itemIds) {
    await tx.delete(partItems).where(eq(partItems.partId, part.id))
    if (itemIds.length) await tx.insert(partItems).values(itemIds.map((itemId) => ({ partId: part.id, itemId })))
  } else if (bikeChanged && bikeId) {
    // Fit links to other bikes' items no longer apply once the part belongs to this bike.
    const keep = tx.select({ id: maintenanceItems.id }).from(maintenanceItems).where(eq(maintenanceItems.bikeId, bikeId))
    await tx.delete(partItems).where(and(eq(partItems.partId, part.id), sql`${partItems.itemId} not in (${keep})`))
  }
}

/** Manual correction: a signed, non-zero 'adjust' movement dated today. */
export async function adjustPart(tx: Tx, userId: string, part: Part, raw: unknown): Promise<void> {
  if (!isObj(raw)) throw bad('Invalid body')
  const clientId = uuid(raw.clientId)
  const q = qty(raw.qtyHundredths, 'qtyHundredths', { allowNegative: true })
  if (q === 0) throw bad('Invalid qtyHundredths')
  await applyMovement(tx, { userId, clientId, part, partName: part.name, unit: part.unit, kind: 'adjust', qtyHundredths: q, at: new Date().toISOString().slice(0, 10), note: notes(raw.note) ?? undefined })
}

/** The user's parts as rows (all, or one by id), sorted by name. */
export async function listPartRows(userId: string, partId?: string): Promise<PartRow[]> {
  const rows = await db
    .select({ p: parts, bikeName: bikes.name })
    .from(parts)
    .leftJoin(bikes, eq(parts.bikeId, bikes.id))
    .where(and(eq(parts.userId, userId), partId ? eq(parts.id, partId) : undefined))
  const links = rows.length
    ? await db.select().from(partItems).where(inArray(partItems.partId, rows.map((r) => r.p.id)))
    : []
  return rows
    .map(({ p, bikeName }) => ({
      id: p.id,
      name: p.name,
      unit: p.unit,
      qtyHundredths: p.qtyHundredths,
      minHundredths: p.minHundredths,
      notes: p.notes,
      bikeId: p.bikeId,
      bikeName,
      itemIds: links.filter((l) => l.partId === p.id).map((l) => l.itemId),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt'))
}

export async function partRow(userId: string, partId: string): Promise<PartRow> {
  const [row] = await listPartRows(userId, partId)
  if (!row) throw notFound()
  return row
}

/** Movements of one part, newest first. `unitCents` = the linked expense's amount per unit, for 'bought'. */
export async function partHistory(userId: string, partId: string): Promise<PartHistoryRow[]> {
  const rows = await db
    .select({ m: partMovements, amountCents: expenses.amountCents, garageName: services.garageName })
    .from(partMovements)
    .leftJoin(expenses, eq(partMovements.expenseId, expenses.id))
    .leftJoin(services, eq(partMovements.serviceId, services.id))
    .where(and(eq(partMovements.userId, userId), eq(partMovements.partId, partId)))
    .orderBy(desc(partMovements.at), desc(partMovements.createdAt))
  return rows.map(({ m, amountCents, garageName }) => ({
    id: m.id,
    kind: m.kind,
    qtyHundredths: m.qtyHundredths,
    at: m.at,
    note: m.note,
    expenseId: m.expenseId,
    documentId: m.documentId,
    serviceId: m.serviceId,
    unitCents: m.kind === 'bought' && amountCents != null && m.qtyHundredths > 0 ? Math.round((amountCents * 100) / m.qtyHundredths) : null,
    garageName: garageName ?? null,
  }))
}
