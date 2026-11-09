import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm'
import { createError } from 'h3'
import { db } from '../db/client'
import { documents, expenseItems, expenses, partMovements, parts, services } from '../db/schema'
import type { Bike, Document, Part } from '../db/schema'
import { cleanDate, countedMeters, isObj, str } from './bikes'
import { bad, isUuid, uuid } from './validate'
import { applyMovement, createPart, qty } from './parts'
import type { Tx } from './expenses'
import { amountCents, checkCategory, checkItemIds, description } from './expenses'
import { insertService } from './services'

const MAX_LINES = 50

/** Lines may be off the invoice total by max(50 cents, 1 %) — rounding and VAT splits. */
export const totalsTolerance = (totalCents: number) => Math.max(50, Math.round(Math.abs(totalCents) / 100))

interface ShelfLine {
  clientId: string
  part: Part | null
  partClientId: string | null
  name: string | null
  unit: string | undefined
  qtyHundredths: number
  /** undefined = the invoice's bike, null = any bike. */
  bikeId: string | null | undefined
}

/** A line's `shelf` object, validated; `partId` must be one of the rider's parts (400 otherwise). */
async function shelfLine(tx: Tx, userId: string, raw: unknown): Promise<ShelfLine> {
  if (!isObj(raw)) throw bad('Invalid shelf line')
  const q = qty(raw.qtyHundredths, 'qtyHundredths')
  if (q <= 0) throw bad('Invalid qtyHundredths')
  const base = { clientId: uuid(raw.clientId, 'shelf clientId'), qtyHundredths: q }
  if (raw.partId !== undefined && raw.partId !== null) {
    if (!isUuid(raw.partId)) throw bad('Invalid partId')
    const [part] = await tx.select().from(parts).where(and(eq(parts.id, raw.partId), eq(parts.userId, userId)))
    if (!part) throw bad('Invalid partId')
    return { ...base, part, partClientId: null, name: null, unit: undefined, bikeId: undefined }
  }
  const name = str(raw.name, 'name', 80)
  const unit = raw.unit === undefined || raw.unit === null ? undefined : str(raw.unit, 'unit', 12)
  const bikeId = raw.bikeId === null ? null : raw.bikeId === undefined ? undefined : uuid(raw.bikeId, 'bikeId')
  return { ...base, part: null, partClientId: uuid(raw.partClientId, 'partClientId'), name, unit, bikeId }
}

const alreadySaved = () => createError({ statusCode: 409, statusMessage: 'This invoice is already saved.' })

export type ConfirmResult =
  | { status: 200; body: { id: string; bikeId: string; serviceId: string | null } }
  | { status: 409; body: { error: 'totals-mismatch'; diffCents: number } }

/**
 * The rider's reviewed invoice → one expense per line and, when any line resets
 * items, one garage service for their union. All or nothing. `doc` and `bike`
 * are ownership-checked; validation is the services/expenses code, not a copy.
 */
export async function confirmInvoice(doc: Document, bike: Bike, raw: unknown): Promise<ConfirmResult> {
  if (!isObj(raw)) throw bad('Invalid body')
  // `replace: true` on a saved invoice = change it: undo what it made, save again, all in one transaction.
  const replace = raw.replace === true
  if (doc.status === 'confirmed' && !replace) throw alreadySaved() // re-checked under the row lock below
  if (!Array.isArray(raw.lines) || raw.lines.length > MAX_LINES) throw bad('Invalid lines')
  if (!raw.lines.length) throw bad('Add at least one line')
  const at = cleanDate(raw.at, 'invoice')
  const { hoursTenths, km } = countedMeters(bike.meters, raw)
  const garageName = raw.garageName == null || raw.garageName === '' ? null : str(raw.garageName, 'garageName')
  const number = raw.number == null || raw.number === '' ? null : str(raw.number, 'number', 60)
  const nif = raw.supplierNif == null || raw.supplierNif === '' ? null : String(raw.supplierNif).replace(/\s/g, '')
  if (nif !== null && !/^\d{9}$/.test(nif)) throw bad('Invalid NIF')
  const clientId = typeof raw.clientId === 'string' ? raw.clientId : crypto.randomUUID()
  const userId = doc.userId

  try {
    return await db.transaction(async (tx): Promise<ConfirmResult> => {
    // Row lock: two taps on Confirm cannot both pass the status check.
    const [fresh] = await tx.select().from(documents).where(and(eq(documents.id, doc.id), eq(documents.userId, userId))).for('update')
    if (!fresh) throw createError({ statusCode: 404, statusMessage: 'Not found' })
    if (fresh.status === 'confirmed') {
      if (!replace) throw alreadySaved()
      await undoInvoice(tx, fresh) // rolled back with everything else if the new version fails
    }

    const lines = []
    for (const l of raw.lines as unknown[]) {
      if (!isObj(l)) throw bad('Invalid lines')
      lines.push({
        description: description(l.description),
        amountCents: amountCents(l.amountCents),
        categoryId: await checkCategory(userId, l.categoryId, tx),
        shelf: l.shelf == null ? null : await shelfLine(tx, userId, l.shelf),
        // A shelf line is stock, not a service: its item links are ignored.
        itemIds: l.shelf == null ? await checkItemIds(bike, l.itemIds, {}, tx) : [],
      })
    }
    const shelfIds = lines.flatMap((l) => (l.shelf ? [l.shelf.clientId] : []))
    if (new Set(shelfIds).size !== shelfIds.length) throw bad('Duplicate shelf clientId')

    // QR total when there is a QR (it is the only total stored then), else the read/typed one.
    const total = fresh.totalCents
    if (total != null && raw.forceTotals !== true) {
      const diffCents = lines.reduce((s, l) => s + l.amountCents, 0) - total
      // Thrown, not returned: a replace must roll its undo back.
      if (Math.abs(diffCents) > totalsTolerance(total)) throw new TotalsMismatch(diffCents)
    }

    const itemIds = [...new Set(lines.flatMap((l) => l.itemIds))]
    let serviceId: string | null = null
    if (itemIds.length) {
      serviceId = await insertService(bike, { clientId, at, hoursTenths, km, by: 'garage', garageName, itemIds, documentId: fresh.id }, tx)
      if (!serviceId) throw alreadySaved()
    }

    for (const [i, l] of lines.entries()) {
      const [exp] = await tx
        .insert(expenses)
        .values({ userId, bikeId: bike.id, at, amountCents: l.amountCents, categoryId: l.categoryId, description: l.description, documentId: fresh.id, documentLine: i + 1, serviceId: l.shelf ? null : serviceId })
        .returning({ id: expenses.id })
      if (l.shelf) {
        const s = l.shelf
        const part =
          s.part ??
          (await createPart(tx, userId, { clientId: s.partClientId, name: s.name, ...(s.unit ? { unit: s.unit } : {}), bikeId: s.bikeId === undefined ? bike.id : s.bikeId }))
        // Mark a part this very save created (created in this transaction), so deleting the invoice can take it away.
        if (!s.part) await tx.update(parts).set({ createdByDocumentId: fresh.id }).where(and(eq(parts.id, part.id), eq(parts.userId, userId), sql`${parts.createdAt} = now()`))
        await applyMovement(tx, {
          userId, clientId: s.clientId, part, partName: part.name, unit: part.unit, kind: 'bought', qtyHundredths: s.qtyHundredths, at, expenseId: exp!.id, documentId: fresh.id,
        })
      }
      if (l.itemIds.length) await tx.insert(expenseItems).values(l.itemIds.map((itemId) => ({ expenseId: exp!.id, itemId })))
    }

    await tx
      .update(documents)
      .set({
        status: 'confirmed',
        error: null,
        supplierName: garageName ?? fresh.supplierName,
        // QR fields are ground truth and never overwritten.
        ...(fresh.qrRaw ? {} : { issuedAt: at, number: number ?? fresh.number, supplierNif: nif ?? fresh.supplierNif }),
      })
      .where(and(eq(documents.id, fresh.id), eq(documents.userId, userId)))
    return { status: 200, body: { id: fresh.id, bikeId: bike.id, serviceId } }
    })
  } catch (e) {
    if (e instanceof TotalsMismatch) return { status: 409, body: { error: 'totals-mismatch', diffCents: e.diffCents } }
    throw e
  }
}

class TotalsMismatch extends Error {
  constructor(readonly diffCents: number) {
    super('totals-mismatch')
  }
}

const ofDoc = (doc: Document) => ({
  movement: and(eq(partMovements.documentId, doc.id), eq(partMovements.userId, doc.userId), eq(partMovements.kind, 'bought')),
  expense: and(eq(expenses.documentId, doc.id), eq(expenses.userId, doc.userId)),
  service: and(eq(services.documentId, doc.id), eq(services.userId, doc.userId)),
})

/**
 * Remove what saving this invoice created: its shelf stock (each part lowered by what was
 * bought, even below zero), its costs (item links cascade) and its garage service (item links
 * cascade, so the bike's items work their status out again). Nothing else is touched.
 */
export async function undoInvoice(tx: Tx, doc: Document) {
  const own = ofDoc(doc)
  const bought = await tx.delete(partMovements).where(own.movement).returning({ partId: partMovements.partId, qty: partMovements.qtyHundredths })
  for (const m of bought) {
    if (!m.partId) continue
    await tx.update(parts).set({ qtyHundredths: sql`${parts.qtyHundredths} - ${m.qty}` }).where(and(eq(parts.id, m.partId), eq(parts.userId, doc.userId)))
  }
  await tx.delete(expenses).where(own.expense)
  await tx.delete(services).where(own.service)
}

/**
 * Delete a document of any status. A saved one first undoes what it created; a shelf part one of
 * its saves created (`createdByDocumentId`) that nothing else ever touched goes too.
 */
export async function deleteDocument(doc: Document) {
  await db.transaction(async (tx) => {
    const [fresh] = await tx.select().from(documents).where(and(eq(documents.id, doc.id), eq(documents.userId, doc.userId))).for('update')
    if (!fresh) throw createError({ statusCode: 404, statusMessage: 'Not found' })
    if (fresh.status === 'confirmed') {
      const made = await tx.select({ partId: parts.id }).from(parts).where(and(eq(parts.createdByDocumentId, fresh.id), eq(parts.userId, fresh.userId)))
      await undoInvoice(tx, fresh)
      const ids = made.map((m) => m.partId)
      if (ids.length) {
        const touched = await tx.select({ partId: partMovements.partId }).from(partMovements).where(inArray(partMovements.partId, ids))
        const gone = ids.filter((id) => !touched.some((t) => t.partId === id))
        if (gone.length) await tx.delete(parts).where(and(inArray(parts.id, gone), eq(parts.userId, fresh.userId)))
      }
    }
    await tx.delete(documents).where(and(eq(documents.id, fresh.id), eq(documents.userId, fresh.userId)))
  })
}

export type SavedForm = {
  bikeId: string | null
  at: string
  hoursTenths: number | null
  km: number | null
  garageName: string | null
  lines: Array<{
    description: string
    amountCents: number
    categoryId: string
    itemIds: string[]
    shelf: { partId: string; name: string; unit: string; qtyHundredths: number } | null
  }>
}

/** What the review form needs to change a saved invoice: what is saved now, line by line. */
export async function savedForm(doc: Document): Promise<SavedForm | null> {
  if (doc.status !== 'confirmed') return null
  const own = ofDoc(doc)
  const exp = await db.select().from(expenses).where(own.expense).orderBy(asc(expenses.documentLine), asc(expenses.createdAt))
  const ids = exp.map((e) => e.id)
  const links = ids.length ? await db.select().from(expenseItems).where(inArray(expenseItems.expenseId, ids)) : []
  const shelf = await db
    .select({ expenseId: partMovements.expenseId, partId: parts.id, name: parts.name, unit: parts.unit, qty: partMovements.qtyHundredths })
    .from(partMovements)
    .innerJoin(parts, eq(partMovements.partId, parts.id))
    .where(own.movement)
  const [svc] = await db.select().from(services).where(own.service)
  return {
    bikeId: exp[0]?.bikeId ?? svc?.bikeId ?? null,
    at: exp[0]?.at ?? svc?.at ?? doc.issuedAt ?? '',
    hoursTenths: svc?.hoursTenths ?? null,
    km: svc?.km ?? null,
    garageName: svc?.garageName ?? doc.supplierName,
    lines: exp.map((e) => {
      const s = shelf.find((m) => m.expenseId === e.id)
      return {
        description: e.description,
        amountCents: e.amountCents,
        categoryId: e.categoryId,
        itemIds: links.filter((l) => l.expenseId === e.id).map((l) => l.itemId),
        shelf: s ? { partId: s.partId, name: s.name, unit: s.unit, qtyHundredths: s.qty } : null,
      }
    }),
  }
}

/** Parts that would go below zero if this invoice's stock were taken back. */
export async function stockWarnings(doc: Document): Promise<Array<{ name: string; unit: string; afterHundredths: number }>> {
  if (doc.status !== 'confirmed') return []
  const rows = await db
    .select({ id: parts.id, name: parts.name, unit: parts.unit, now: parts.qtyHundredths, qty: partMovements.qtyHundredths })
    .from(partMovements)
    .innerJoin(parts, eq(partMovements.partId, parts.id))
    .where(ofDoc(doc).movement)
  const by = new Map<string, { name: string; unit: string; afterHundredths: number }>()
  for (const r of rows) {
    const cur = by.get(r.id) ?? { name: r.name, unit: r.unit, afterHundredths: r.now }
    cur.afterHundredths -= r.qty
    by.set(r.id, cur)
  }
  return [...by.values()].filter((w) => w.afterHundredths < 0)
}

/** Delete an unconfirmed document and its files (the review screen's Discard). A saved invoice is deleted with `deleteDocument`. */
export async function discardDocument(doc: Document) {
  const [row] = await db
    .delete(documents)
    .where(and(eq(documents.id, doc.id), eq(documents.userId, doc.userId), ne(documents.status, 'confirmed')))
    .returning({ id: documents.id })
  if (!row) throw createError({ statusCode: 409, statusMessage: "A confirmed invoice can't be discarded." })
}
