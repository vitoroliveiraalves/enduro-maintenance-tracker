import { createError, defineEventHandler, getQuery, getRouterParam } from 'h3'
import { requireUser } from '../../utils/require-user'
import { templatesFor } from '../../domain/templates'
import { bad } from '../../utils/validate'
import { isBikeMeters } from '../../../shared/utils/meters'

export default defineEventHandler(async (event) => {
  await requireUser(event)
  const stroke = getRouterParam(event, 'stroke')
  if (stroke !== '2T' && stroke !== '4T') throw createError({ statusCode: 404, statusMessage: 'Not found' })
  const meters = getQuery(event).meters ?? 'hours_km'
  if (!isBikeMeters(meters)) throw bad('Invalid meters')
  return templatesFor(stroke, meters)
})
