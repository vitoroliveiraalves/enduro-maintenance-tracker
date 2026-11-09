import { and, eq } from 'drizzle-orm'
import { defineEventHandler, getRouterParam } from 'h3'
import { db } from '../../db/client'
import { parts } from '../../db/schema'
import { ownedPart } from '../../utils/owned'

/** Movements keep their name/unit snapshot (partId -> null); expenses are untouched. */
export default defineEventHandler(async (event) => {
  const part = await ownedPart(event, getRouterParam(event, 'id') ?? '')
  await db.delete(parts).where(and(eq(parts.id, part.id), eq(parts.userId, part.userId)))
  return { ok: true }
})
