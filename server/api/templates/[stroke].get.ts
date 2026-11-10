import { createError, defineEventHandler, getQuery, getRouterParam } from 'h3'
import { requireUser } from '../../utils/require-user'
import { templatesFor } from '../../domain/templates'
import { bad } from '../../utils/validate'
import { isBikeMeters } from '../../../shared/utils/meters'

export default defineEventHandler(async (event) => {
  await requireUser(event)
  const stroke = getRouterParam(event, 'stroke')
  const query = getQuery(event)
  const vehicleType = (query.vehicleType ?? query.type ?? (stroke === 'car' ? 'car' : 'motorcycle')) as 'motorcycle' | 'car'
  if (vehicleType === 'car' || stroke === 'car') {
    return templatesFor('4T', 'km', 'car')
  }
  if (stroke !== '2T' && stroke !== '4T') throw createError({ statusCode: 404, statusMessage: 'Not found' })
  const meters = query.meters ?? 'hours_km'
  if (!isBikeMeters(meters)) throw bad('Invalid meters')
  return templatesFor(stroke, meters, 'motorcycle')
})
