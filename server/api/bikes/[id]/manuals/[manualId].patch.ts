import { createError, defineEventHandler, getRouterParam, readBody } from 'h3'
import { patchManual } from '../../../../utils/manuals'
import { ownedBike } from '../../../../utils/owned'

export default defineEventHandler(async (event) => {
  const bike = await ownedBike(event, getRouterParam(event, 'id') ?? '')
  const manualId = getRouterParam(event, 'manualId') ?? ''
  const body = await readBody(event)
  const updated = await patchManual(bike, manualId, body)
  if (!updated) throw createError({ statusCode: 404, statusMessage: 'Not found' })
  return updated
})
