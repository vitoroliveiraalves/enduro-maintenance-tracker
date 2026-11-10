import { defineEventHandler } from 'h3'
import { aiEnabled, isAdmin } from '../utils/admin'
import { requireUser } from '../utils/require-user'

/** This account's flags: admin screen shown, beta AI features on. */
export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  return { admin: isAdmin(event, u.email), aiEnabled: await aiEnabled(u.id) }
})
