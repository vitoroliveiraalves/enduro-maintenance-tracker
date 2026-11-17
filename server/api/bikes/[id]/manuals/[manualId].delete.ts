import { createError, defineEventHandler, getRouterParam } from 'h3'
import { deleteManual } from '../../../../utils/manuals'
import { ownedBike } from '../../../../utils/owned'

export default defineEventHandler(async (event) => {
  const bike = await ownedBike(event, getRouterParam(event, 'id') ?? '')
  const manualId = getRouterParam(event, 'manualId') ?? ''
  const ok = await deleteManual(bike, manualId)
  if (!ok) throw createError({ statusCode: 404, statusMessage: 'Not found' })
  return { ok: true }
})
