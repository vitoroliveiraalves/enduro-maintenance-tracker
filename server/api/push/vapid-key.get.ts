import { createError, defineEventHandler } from 'h3'
import { vapidFrom } from '../../utils/push'

/** The public VAPID key, or 404 when push isn't configured on this server. */
export default defineEventHandler((event) => {
  const v = vapidFrom(useRuntimeConfig(event))
  if (!v) throw createError({ statusCode: 404, statusMessage: 'Push not configured' })
  return { key: v.publicKey }
})
