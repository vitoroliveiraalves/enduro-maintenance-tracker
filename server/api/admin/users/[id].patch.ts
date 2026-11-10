import { eq } from 'drizzle-orm'
import { createError, defineEventHandler, getRouterParam, readBody } from 'h3'
import { db } from '../../../db/client'
import { user } from '../../../db/schema'
import { requireAdmin } from '../../../utils/admin'
import { isUuid } from '../../../utils/validate'

/** Admin: switch the beta AI features on/off for one account. */
export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const id = getRouterParam(event, 'id') ?? ''
  if (!isUuid(id)) throw createError({ statusCode: 404, statusMessage: 'Not found' })
  const body = await readBody(event).catch(() => null)
  if (typeof body?.aiEnabled !== 'boolean') throw createError({ statusCode: 400, statusMessage: 'aiEnabled must be true or false.' })
  const [row] = await db.update(user).set({ aiEnabled: body.aiEnabled }).where(eq(user.id, id)).returning({ id: user.id, aiEnabled: user.aiEnabled })
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Not found' })
  return row
})
