import { defineEventHandler, getQuery } from 'h3'
import { requireUser } from '../../utils/require-user'
import { ownedBike } from '../../utils/owned'
import { listServices } from '../../utils/services'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const { bikeId } = getQuery(event)
  const bike = typeof bikeId === 'string' && bikeId ? await ownedBike(event, bikeId) : null
  return listServices(user.id, { ...(bike ? { bikeId: bike.id } : {}) })
})
