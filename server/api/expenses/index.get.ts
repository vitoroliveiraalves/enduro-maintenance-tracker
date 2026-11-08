import { defineEventHandler, getQuery } from 'h3'
import { requireUser } from '../../utils/require-user'
import { ownedBike } from '../../utils/owned'
import { listExpenses } from '../../utils/expenses'

const DAY = /^\d{4}-\d{2}-\d{2}$/

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const q = getQuery(event)
  const bike = typeof q.bikeId === 'string' && q.bikeId ? await ownedBike(event, q.bikeId) : null
  const day = (v: unknown) => (typeof v === 'string' && DAY.test(v) ? v : undefined)
  const from = day(q.from)
  const to = day(q.to)
  return listExpenses(user.id, { ...(bike ? { bikeId: bike.id } : {}), ...(from ? { from } : {}), ...(to ? { to } : {}) })
})
