import { defineEventHandler, getQuery } from 'h3'
import { requireUser } from '../../utils/require-user'
import { ownedBike } from '../../utils/owned'
import { listExpenses } from '../../utils/expenses'
import { bad, isDay } from '../../utils/validate'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const q = getQuery(event)
  const bike = typeof q.bikeId === 'string' && q.bikeId ? await ownedBike(event, q.bikeId) : null
  const day = (v: unknown) => {
    if (v === undefined || v === '') return undefined
    if (!isDay(v)) throw bad('Invalid date')
    return v
  }
  const from = day(q.from)
  const to = day(q.to)
  return listExpenses(user.id, { ...(bike ? { bikeId: bike.id } : {}), ...(from ? { from } : {}), ...(to ? { to } : {}) })
})
