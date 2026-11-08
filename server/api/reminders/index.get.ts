import { defineEventHandler, getQuery } from 'h3'
import { requireUser } from '../../utils/require-user'
import { ownedBike } from '../../utils/owned'
import { listReminders } from '../../utils/reminders'

/** Open reminders, soonest first. `?bikeId=` → that bike's plus the bike-less ones. */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const { bikeId } = getQuery(event)
  if (typeof bikeId === 'string' && bikeId) {
    const bike = await ownedBike(event, bikeId)
    return listReminders(user.id, bike.id)
  }
  return listReminders(user.id)
})
