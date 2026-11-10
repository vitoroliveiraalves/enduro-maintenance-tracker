import { defineEventHandler, readBody } from 'h3'
import { requireUser } from '../../utils/require-user'
import { createApiToken } from '../../utils/tokens'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const body = await readBody(event)
  return createApiToken(user.id, body?.name)
})
