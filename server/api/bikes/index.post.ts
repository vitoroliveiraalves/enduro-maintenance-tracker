import { defineEventHandler, readBody } from 'h3'
import { requireUser } from '../../utils/require-user'
import { createBike } from '../../utils/bikes'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  return createBike(user.id, await readBody(event))
})
