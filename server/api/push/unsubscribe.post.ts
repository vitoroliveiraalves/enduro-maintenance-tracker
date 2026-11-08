import { defineEventHandler, readBody } from 'h3'
import { requireUser } from '../../utils/require-user'
import { removeSubscription } from '../../utils/push'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  await removeSubscription(user.id, await readBody(event))
  return { ok: true }
})
