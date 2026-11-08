import { and, desc, eq, gte, inArray, lte } from 'drizzle-orm'
import { db } from '../db/client'
import { categories, documents, expenseItems, expenses, maintenanceItems } from '../db/schema'
import type { Bike } from '../db/schema'
import { bad, cleanDate, int, isObj, uuid } from './bikes'

type Tx = Pick<typeof db, 'select' | 'insert' | 'delete' | 'update'>

export const MAX_AMOUNT_CENTS = 10_000_000

export function amountCents(v: unknown): number {
  return int(v, 'amountCents', 1, MAX_AMOUNT_CENTS)
}

export function description(v: unknown): string {
  if (v === undefined || v === null || v === '') return ''
  if (typeof v !== 'string' || v.trim().length > 200) throw bad('Invalid description')
  return v.trim()
}

/** categoryId must be one of the user's categories. */
export async function checkCategory(userId: string, categoryId: unknown, t: Tx = db): Promise<string> {
  const id = typeof categoryId === 'string' ? categoryId : ''
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw bad('Invalid categoryId')
  const [row] = await t.select({ id: categories.id }).from(categories).where(and(eq(categories.id, id), eq(categories.userId, userId)))
  if (!row) throw bad('Invalid categoryId')
  return id
}

/** Unique item ids that must all belong to `bike`; anything else is a 400. */
export async function checkItemIds(bike: Bike, raw: unknown, { min = 0 }: { min?: number } = {}, t: Tx = db): Promise<string[]> {
  if (raw === undefined || raw === null) raw = []
  if (!Array.isArray(raw) || raw.length > 80) throw bad('Invalid itemIds')
  const ids = [...new Set(raw.map((x) => uuid(x, 'itemIds')))]
  if (ids.length < min) throw bad('Pick at least one item')
  if (ids.length) {
    const found = await t
      .select({ id: maintenanceItems.id })
      .from(maintenanceItems)
      .where(and(inArray(maintenanceItems.id, ids), eq(maintenanceItems.bikeId, bike.id), eq(maintenanceItems.userId, bike.userId)))
    if (found.length !== ids.length) throw bad('Invalid itemIds')
  }
  return ids
}

export async function checkDocument(userId: string, raw: unknown, t: Tx = db): Promise<string | null> {
  if (raw === undefined || raw === null) return null
  const id = uuid(raw, 'documentId')
  const [row] = await t.select({ id: documents.id }).from(documents).where(and(eq(documents.id, id), eq(documents.userId, userId)))
  if (!row) throw bad('Invalid documentId')
  return id
}

const expenseRow = (e: typeof expenses.$inferSelect, c: { name: string; kind: string }, itemIds: string[]) => ({
  id: e.id,
  bikeId: e.bikeId,
  at: e.at,
  amountCents: e.amountCents,
  categoryId: e.categoryId,
  categoryName: c.name,
  categoryKind: c.kind,
  description: e.description,
  documentId: e.documentId,
  serviceId: e.serviceId,
  itemIds,
})
export type ExpenseRow = ReturnType<typeof expenseRow>

/** Standalone expense (no service). `bike` is the ownership-checked bike, or null. Idempotent on clientId. */
export async function createExpense(userId: string, bike: Bike | null, raw: unknown): Promise<ExpenseRow> {
  if (!isObj(raw)) throw bad('Invalid body')
  const clientId = uuid(raw.clientId)
  const at = cleanDate(raw.at, 'expense')
  const cents = amountCents(raw.amountCents)
  const desc = description(raw.description)
  if (!bike && Array.isArray(raw.itemIds) && raw.itemIds.length) throw bad('itemIds need a bike')
  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(expenses).where(and(eq(expenses.userId, userId), eq(expenses.clientId, clientId)))
    if (existing) return (await listExpenses(userId, { id: existing.id }, tx))[0]!
    const categoryId = await checkCategory(userId, raw.categoryId, tx)
    const itemIds = bike ? await checkItemIds(bike, raw.itemIds, {}, tx) : []
    const [row] = await tx
      .insert(expenses)
      .values({ userId, clientId, bikeId: bike?.id ?? null, at, amountCents: cents, categoryId, description: desc })
      .onConflictDoNothing({ target: [expenses.userId, expenses.clientId] })
      .returning()
    if (!row) {
      const [again] = await tx.select().from(expenses).where(and(eq(expenses.userId, userId), eq(expenses.clientId, clientId)))
      return (await listExpenses(userId, { id: again!.id }, tx))[0]!
    }
    if (itemIds.length) await tx.insert(expenseItems).values(itemIds.map((itemId) => ({ expenseId: row.id, itemId })))
    return (await listExpenses(userId, { id: row.id }, tx))[0]!
  })
}

export async function patchExpense(userId: string, expense: typeof expenses.$inferSelect, raw: unknown): Promise<ExpenseRow> {
  if (!isObj(raw)) throw bad('Invalid body')
  const set: Partial<typeof expenses.$inferInsert> = {}
  if (raw.amountCents !== undefined) set.amountCents = amountCents(raw.amountCents)
  if (raw.description !== undefined) set.description = description(raw.description)
  if (raw.at !== undefined) set.at = cleanDate(raw.at, 'expense')
  if (raw.categoryId !== undefined) set.categoryId = await checkCategory(userId, raw.categoryId)
  if (Object.keys(set).length) await db.update(expenses).set(set).where(and(eq(expenses.id, expense.id), eq(expenses.userId, userId)))
  return (await listExpenses(userId, { id: expense.id }))[0]!
}

export async function deleteExpense(userId: string, expenseId: string) {
  await db.delete(expenses).where(and(eq(expenses.id, expenseId), eq(expenses.userId, userId)))
}

export async function listExpenses(
  userId: string,
  f: { id?: string; bikeId?: string; from?: string; to?: string } = {},
  t: Tx = db,
): Promise<ExpenseRow[]> {
  const where = and(
    eq(expenses.userId, userId),
    f.id ? eq(expenses.id, f.id) : undefined,
    f.bikeId ? eq(expenses.bikeId, f.bikeId) : undefined,
    f.from ? gte(expenses.at, f.from) : undefined,
    f.to ? lte(expenses.at, f.to) : undefined,
  )
  const rows = await t
    .select({ e: expenses, c: { name: categories.name, kind: categories.kind } })
    .from(expenses)
    .innerJoin(categories, eq(expenses.categoryId, categories.id))
    .where(where)
    .orderBy(desc(expenses.at), desc(expenses.createdAt))
  const ids = rows.map((r) => r.e.id)
  const links = ids.length ? await t.select().from(expenseItems).where(inArray(expenseItems.expenseId, ids)) : []
  return rows.map(({ e, c }) =>
    expenseRow(e, c, links.filter((l) => l.expenseId === e.id).map((l) => l.itemId)),
  )
}

