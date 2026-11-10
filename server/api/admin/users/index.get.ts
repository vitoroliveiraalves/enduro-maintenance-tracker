import { defineEventHandler } from 'h3'
import { listRiders, requireAdmin } from '../../../utils/admin'

/** Admin: every account with last login, usage counts and the AI flag. */
export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  return listRiders()
})
