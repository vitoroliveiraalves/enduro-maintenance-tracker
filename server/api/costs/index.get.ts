import { defineEventHandler, getQuery } from 'h3'
import { requireUser } from '../../utils/require-user'
import { costsOverview, parseCostsQuery } from '../../domain/costs-query'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  return costsOverview(user.id, parseCostsQuery(getQuery(event)))
})
