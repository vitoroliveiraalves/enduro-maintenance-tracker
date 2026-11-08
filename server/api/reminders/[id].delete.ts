import { defineEventHandler, getRouterParam } from 'h3'
import { ownedReminder } from '../../utils/owned'
import { deleteReminder } from '../../utils/reminders'

export default defineEventHandler(async (event) => {
  const reminder = await ownedReminder(event, getRouterParam(event, 'id') ?? '')
  await deleteReminder(reminder.userId, reminder.id)
  return { ok: true }
})
