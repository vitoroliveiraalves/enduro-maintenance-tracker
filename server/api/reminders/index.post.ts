import { defineEventHandler, readBody } from 'h3'
import { requireUser } from '../../utils/require-user'
import { ownedBike } from '../../utils/owned'
import { createReminder } from '../../utils/reminders'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const body = await readBody(event)
  const bike = typeof body?.bikeId === 'string' && body.bikeId ? await ownedBike(event, body.bikeId) : null
  return createReminder(user.id, bike, body)
})
