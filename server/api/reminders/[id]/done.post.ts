import { defineEventHandler, getRouterParam, readBody } from 'h3'
import { ownedReminder } from '../../../utils/owned'
import { markReminderDone } from '../../../utils/reminders'

/** Body may carry the `dueOn` the rider saw, so a replayed tap doesn't roll a yearly reminder twice. */
export default defineEventHandler(async (event) => {
  const reminder = await ownedReminder(event, getRouterParam(event, 'id') ?? '')
  return markReminderDone(reminder.userId, reminder, await readBody(event))
})
