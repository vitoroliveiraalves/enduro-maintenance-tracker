import { createError, defineEventHandler, getRouterParam } from 'h3'
import { requireUser } from '../../utils/require-user'
import { revokeApiToken } from '../../utils/tokens'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const id = getRouterParam(event, 'id') ?? ''
  const revoked = await revokeApiToken(user.id, id)
  if (!revoked) throw createError({ statusCode: 404, statusMessage: 'Token not found' })
  return { ok: true }
})
