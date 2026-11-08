import { and, eq, ne } from 'drizzle-orm'
import { createError } from 'h3'
import { db } from '../db/client'
import { documents, expenseItems, expenses } from '../db/schema'
import type { Bike, Document } from '../db/schema'
import { cleanDate, isObj, optInt, str } from './bikes'
import { bad } from './validate'
import { amountCents, checkCategory, checkItemIds, description } from './expenses'
import { insertService } from './services'

const MAX_LINES = 50

/** Lines may be off the invoice total by max(50 cents, 1 %) — rounding and VAT splits. */
export const totalsTolerance = (totalCents: number) => Math.max(50, Math.round(Math.abs(totalCents) / 100))

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
  if (doc.status === 'confirmed') throw alreadySaved() // re-checked under the row lock below
  if (!isObj(raw)) throw bad('Invalid body')
  if (!Array.isArray(raw.lines) || raw.lines.length > MAX_LINES) throw bad('Invalid lines')
  if (!raw.lines.length) throw bad('Add at least one line')
  const at = cleanDate(raw.at, 'invoice')
  const hoursTenths = optInt(raw.hoursTenths, 'hoursTenths')
  const km = optInt(raw.km, 'km')
  const garageName = raw.garageName == null || raw.garageName === '' ? null : str(raw.garageName, 'garageName')
  const number = raw.number == null || raw.number === '' ? null : str(raw.number, 'number', 60)
  const nif = raw.supplierNif == null || raw.supplierNif === '' ? null : String(raw.supplierNif).replace(/\s/g, '')
  if (nif !== null && !/^\d{9}$/.test(nif)) throw bad('Invalid NIF')
  const clientId = typeof raw.clientId === 'string' ? raw.clientId : crypto.randomUUID()
  const userId = doc.userId

  return db.transaction(async (tx): Promise<ConfirmResult> => {
    // Row lock: two taps on Confirm cannot both pass the status check.
    const [fresh] = await tx.select().from(documents).where(and(eq(documents.id, doc.id), eq(documents.userId, userId))).for('update')
    if (!fresh) throw createError({ statusCode: 404, statusMessage: 'Not found' })
    if (fresh.status === 'confirmed') throw alreadySaved()

    const lines = []
    for (const l of raw.lines as unknown[]) {
      if (!isObj(l)) throw bad('Invalid lines')
      lines.push({
        description: description(l.description),
        amountCents: amountCents(l.amountCents),
        categoryId: await checkCategory(userId, l.categoryId, tx),
        itemIds: await checkItemIds(bike, l.itemIds, {}, tx),
      })
    }

    // QR total when there is a QR (it is the only total stored then), else the read/typed one.
    const total = fresh.totalCents
    if (total != null && raw.forceTotals !== true) {
      const diffCents = lines.reduce((s, l) => s + l.amountCents, 0) - total
      if (Math.abs(diffCents) > totalsTolerance(total)) return { status: 409, body: { error: 'totals-mismatch', diffCents } }
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
        .values({ userId, bikeId: bike.id, at, amountCents: l.amountCents, categoryId: l.categoryId, description: l.description, documentId: fresh.id, documentLine: i + 1, serviceId })
        .returning({ id: expenses.id })
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
}

/** Delete an unconfirmed document and its files. A saved invoice stays until its expenses are deleted. */
export async function discardDocument(doc: Document) {
  const [row] = await db
    .delete(documents)
    .where(and(eq(documents.id, doc.id), eq(documents.userId, doc.userId), ne(documents.status, 'confirmed')))
    .returning({ id: documents.id })
  if (!row) throw createError({ statusCode: 409, statusMessage: 'A saved invoice can’t be discarded — delete its expenses first.' })
}
