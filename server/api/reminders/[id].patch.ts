import { defineEventHandler, getRouterParam, readBody } from 'h3'
import { ownedBike, ownedReminder } from '../../utils/owned'
import { patchReminder } from '../../utils/reminders'

export default defineEventHandler(async (event) => {
  const reminder = await ownedReminder(event, getRouterParam(event, 'id') ?? '')
  const body = await readBody(event)
  const bike = typeof body?.bikeId === 'string' ? await ownedBike(event, body.bikeId) : null
  return patchReminder(reminder.userId, reminder, bike, body)
})
