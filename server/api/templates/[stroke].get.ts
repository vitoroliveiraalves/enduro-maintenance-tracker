import { createError, defineEventHandler, getRouterParam } from 'h3'
import { requireUser } from '../../utils/require-user'
import { TEMPLATES } from '../../domain/templates'

// TEMPLATES share objects between 2T and 4T: always hand out a copy.
export default defineEventHandler(async (event) => {
  await requireUser(event)
  const stroke = getRouterParam(event, 'stroke')
  if (stroke !== '2T' && stroke !== '4T') throw createError({ statusCode: 404, statusMessage: 'Not found' })
  return structuredClone(TEMPLATES[stroke])
})
