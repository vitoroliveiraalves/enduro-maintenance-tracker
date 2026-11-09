import { sql } from 'drizzle-orm'
import { createError, defineEventHandler } from 'h3'
import { db } from '../db/client'

/** Liveness + database reachability, for uptime checks and container health. */
export default defineEventHandler(async () => {
  try {
    await db.execute(sql`select 1`)
  } catch {
    throw createError({ statusCode: 503, statusMessage: 'Database unavailable' })
  }
  return { ok: true }
})
