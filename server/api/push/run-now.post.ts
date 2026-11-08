import { createError, defineEventHandler } from 'h3'
import { requireUser } from '../../utils/require-user'
import { runNotify, vapidFrom, webPushSender } from '../../utils/push'

/** Dev/e2e only: run the due-check now for the signed-in user. */
export default defineEventHandler(async (event) => {
  if (process.env.NODE_ENV === 'production') throw createError({ statusCode: 404, statusMessage: 'Not found' })
  const user = await requireUser(event)
  const v = vapidFrom(useRuntimeConfig(event))
  if (!v) throw createError({ statusCode: 404, statusMessage: 'Push not configured' })
  return runNotify({ now: new Date(), send: webPushSender(v), userId: user.id })
})
