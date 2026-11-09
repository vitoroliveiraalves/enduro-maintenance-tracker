import { and, eq } from 'drizzle-orm'
import { defineEventHandler, getRouterParam } from 'h3'
import { db } from '../../db/client'
import { shoppingEntries } from '../../db/schema'
import { ownedShoppingEntry } from '../../utils/owned'

export default defineEventHandler(async (event) => {
  const entry = await ownedShoppingEntry(event, getRouterParam(event, 'id') ?? '')
  await db.delete(shoppingEntries).where(and(eq(shoppingEntries.id, entry.id), eq(shoppingEntries.userId, entry.userId)))
  return { ok: true }
})
