import { defineEventHandler } from 'h3'
import { requireUser } from '../../utils/require-user'
import { listApiTokens } from '../../utils/tokens'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  return listApiTokens(user.id)
})
