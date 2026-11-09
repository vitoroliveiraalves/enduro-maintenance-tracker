import { and, asc, eq, isNull } from 'drizzle-orm'
import { db } from '../db/client'
import { bikes, parts, shoppingEntries } from '../db/schema'
import type { ShoppingEntry } from '../db/schema'
import { isObj, itemRows, str } from './bikes'
import { listPartRows } from './parts'
import type { PartRow } from './parts'
import type { Tx } from './expenses'
import { bad, isUuid, uuid } from './validate'
import { createError } from 'h3'

export interface AutoEntry {
  key: string
  partId: string
  partName: string
  unit: string
  bikeId: string | null
  bikeName: string | null
  reason: 'due' | 'min'
  detail: string
}

export interface ManualEntry {
  id: string
  text: string
  bikeId: string | null
  bikeName: string | null
  partId: string | null
  doneAt: string | null
}

export interface ShoppingList {
  auto: AutoEntry[]
  manual: ManualEntry[]
}

export interface BikeItems {
  bikeId: string
  bikeName: string
  items: Array<{ id: string; name: string; state: 'overdue' | 'soon' | 'ok' | 'unknown' }>
}

const MAX_TEXT = 120
const DONE_VISIBLE_DAYS = 7

/** Hundredths as a plain number: 150 -> "1.5", 200 -> "2". */
const fmtQty = (h: number, unit: string) => `${Number((h / 100).toFixed(2))}${unit === 'pcs' ? '' : ` ${unit}`}`

/**
 * What to buy, from the shelf alone: a part linked to an overdue/soon item that
 * is out of stock ('due'), or a part under its minimum ('min'). A part matching
 * both is listed once as 'due', naming its most urgent item (overdue before soon).
 */
export function computeAuto(shelf: PartRow[], bikes: BikeItems[]): AutoEntry[] {
  const owner = new Map<string, { bike: BikeItems; item: BikeItems['items'][number] }>()
  for (const bike of bikes) for (const item of bike.items) owner.set(item.id, { bike, item })

  const out: AutoEntry[] = []
  for (const p of shelf) {
    const base = { partId: p.id, partName: p.name, unit: p.unit }
    const due = p.qtyHundredths > 0 ? [] : p.itemIds.flatMap((id) => owner.get(id) ?? []).filter((o) => o.item.state === 'overdue' || o.item.state === 'soon')
    const top = due.find((o) => o.item.state === 'overdue') ?? due[0]
    if (top) {
      out.push({ ...base, key: `due:${p.id}`, bikeId: top.bike.bikeId, bikeName: top.bike.bikeName, reason: 'due', detail: `${top.item.name} on ${top.bike.bikeName} — ${top.item.state === 'overdue' ? 'overdue' : 'due soon'}` })
    } else if (p.minHundredths != null && p.qtyHundredths < p.minHundredths) {
      out.push({ ...base, key: `min:${p.id}`, bikeId: p.bikeId, bikeName: p.bikeName, reason: 'min', detail: `keep ${fmtQty(p.minHundredths, p.unit)}, have ${fmtQty(p.qtyHundredths, p.unit)}` })
    }
  }
  return out
}

/** Ticked entries stay visible for a week, then drop off the list. */
export function isVisibleManual(doneAt: Date | null, now = new Date()): boolean {
  return !doneAt || now.getTime() - doneAt.getTime() <= DONE_VISIBLE_DAYS * 86_400_000
}

const notFound = () => createError({ statusCode: 404, statusMessage: 'Not found' })

function entryText(v: unknown) {
  return str(v, 'text', MAX_TEXT)
}

/** The user's bike, else 404 (like readings). */
async function checkBike(tx: Tx, userId: string, bikeId: string) {
  if (!isUuid(bikeId)) throw notFound()
  const [b] = await tx.select({ id: bikes.id }).from(bikes).where(and(eq(bikes.id, bikeId), eq(bikes.userId, userId)))
  if (!b) throw notFound()
}

/** The user's part, else 400: it is a reference in the body, not the resource addressed. */
async function checkPart(tx: Tx, userId: string, partId: string) {
  if (!isUuid(partId)) throw bad('Invalid partId')
  const [p] = await tx.select({ id: parts.id }).from(parts).where(and(eq(parts.id, partId), eq(parts.userId, userId)))
  if (!p) throw bad('Invalid partId')
}

function refId(v: unknown, field: string): string | null {
  if (v === null || v === undefined) return null
  if (typeof v !== 'string') throw bad(`Invalid ${field}`)
  return v
}

/** Create a manual entry; a replayed clientId returns the existing one. */
export async function createEntry(tx: Tx, userId: string, raw: unknown): Promise<ShoppingEntry> {
  if (!isObj(raw)) throw bad('Invalid body')
  const clientId = uuid(raw.clientId)
  const values = { userId, clientId, text: entryText(raw.text), bikeId: refId(raw.bikeId, 'bikeId'), partId: refId(raw.partId, 'partId') }
  if (values.bikeId) await checkBike(tx, userId, values.bikeId)
  if (values.partId) await checkPart(tx, userId, values.partId)
  const [row] = await tx.insert(shoppingEntries).values(values).onConflictDoNothing({ target: [shoppingEntries.userId, shoppingEntries.clientId] }).returning()
  if (row) return row
  const [existing] = await tx.select().from(shoppingEntries).where(and(eq(shoppingEntries.userId, userId), eq(shoppingEntries.clientId, clientId)))
  return existing!
}

/** Edit the text and/or tick/untick an entry. `entry` must be ownership-checked. */
export async function patchEntry(entry: ShoppingEntry, raw: unknown): Promise<ShoppingEntry> {
  if (!isObj(raw)) throw bad('Invalid body')
  const set: Partial<typeof shoppingEntries.$inferInsert> = {}
  if (raw.text !== undefined) set.text = entryText(raw.text)
  if (raw.done !== undefined) {
    if (typeof raw.done !== 'boolean') throw bad('Invalid done')
    set.doneAt = raw.done ? entry.doneAt ?? new Date() : null
  }
  if (!Object.keys(set).length) return entry
  const [row] = await db.update(shoppingEntries).set({ ...set, updatedAt: new Date() }).where(and(eq(shoppingEntries.id, entry.id), eq(shoppingEntries.userId, entry.userId))).returning()
  return row!
}

const manualRow = (e: ShoppingEntry, bikeName: string | null): ManualEntry => ({
  id: e.id,
  text: e.text,
  bikeId: e.bikeId,
  bikeName,
  partId: e.partId,
  doneAt: e.doneAt ? e.doneAt.toISOString() : null,
})

export async function shoppingList(userId: string, now = new Date()): Promise<ShoppingList> {
  const [shelf, activeBikes, entries] = await Promise.all([
    listPartRows(userId),
    db.select({ id: bikes.id, name: bikes.name }).from(bikes).where(and(eq(bikes.userId, userId), isNull(bikes.archivedAt))).orderBy(asc(bikes.createdAt)),
    db
      .select({ e: shoppingEntries, bikeName: bikes.name })
      .from(shoppingEntries)
      .leftJoin(bikes, eq(shoppingEntries.bikeId, bikes.id))
      .where(eq(shoppingEntries.userId, userId))
      .orderBy(asc(shoppingEntries.createdAt)),
  ])
  const needsItems = shelf.some((p) => p.itemIds.length > 0)
  const bikeItems: BikeItems[] = needsItems
    ? await Promise.all(
        activeBikes.map(async (b) => ({
          bikeId: b.id,
          bikeName: b.name,
          items: (await itemRows(b.id, userId, now)).map((i) => ({ id: i.id, name: i.name, state: i.status.state })),
        })),
      )
    : []
  return {
    auto: computeAuto(shelf, bikeItems),
    manual: entries
      .filter(({ e }) => isVisibleManual(e.doneAt, now))
      .map(({ e, bikeName }) => manualRow(e, bikeName)),
  }
}

export async function entryRow(userId: string, id: string): Promise<ManualEntry> {
  const [r] = await db
    .select({ e: shoppingEntries, bikeName: bikes.name })
    .from(shoppingEntries)
    .leftJoin(bikes, eq(shoppingEntries.bikeId, bikes.id))
    .where(and(eq(shoppingEntries.id, id), eq(shoppingEntries.userId, userId)))
  if (!r) throw notFound()
  return manualRow(r.e, r.bikeName)
}
