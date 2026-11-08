import { createError } from 'h3'
import { and, asc, eq } from 'drizzle-orm'
import { db } from '../db/client'
import { categories, categoryKinds, expenses } from '../db/schema'
import type { Category } from '../db/schema'
import { bad, isObj, str, uuid } from './bikes'

export const listCategories = (userId: string) =>
  db.select().from(categories).where(eq(categories.userId, userId)).orderBy(asc(categories.createdAt), asc(categories.name))

export async function createCategory(userId: string, raw: unknown): Promise<Category> {
  if (!isObj(raw)) throw bad('Invalid body')
  const clientId = uuid(raw.clientId)
  const name = str(raw.name, 'name', 60)
  if (typeof raw.kind !== 'string' || !(categoryKinds as readonly string[]).includes(raw.kind)) throw bad('Invalid kind')
  const [row] = await db
    .insert(categories)
    .values({ userId, clientId, name, kind: raw.kind as (typeof categoryKinds)[number] })
    .onConflictDoNothing({ target: [categories.userId, categories.clientId] })
    .returning()
  if (row) return row
  const [existing] = await db.select().from(categories).where(and(eq(categories.userId, userId), eq(categories.clientId, clientId)))
  return existing!
}

export async function renameCategory(userId: string, category: Category, raw: unknown): Promise<Category> {
  if (!isObj(raw)) throw bad('Invalid body')
  const name = str(raw.name, 'name', 60)
  const [row] = await db.update(categories).set({ name }).where(and(eq(categories.id, category.id), eq(categories.userId, userId))).returning()
  return row!
}

/** 409 when any expense still uses the category. */
export async function deleteCategory(userId: string, category: Category) {
  const [used] = await db
    .select({ id: expenses.id })
    .from(expenses)
    .where(and(eq(expenses.categoryId, category.id), eq(expenses.userId, userId)))
    .limit(1)
  if (used) throw createError({ statusCode: 409, statusMessage: 'Category is in use' })
  await db.delete(categories).where(and(eq(categories.id, category.id), eq(categories.userId, userId)))
}
