import { createError, defineEventHandler, readBody } from 'h3'
import { requireUser } from '../../utils/require-user'
import { saveSubscription, vapidFrom } from '../../utils/push'

/** Body: PushSubscription.toJSON() plus `timezone` (IANA, from Intl). */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  if (!vapidFrom(useRuntimeConfig(event))) throw createError({ statusCode: 404, statusMessage: 'Push not configured' })
  await saveSubscription(user.id, await readBody(event))
  return { ok: true }
})
