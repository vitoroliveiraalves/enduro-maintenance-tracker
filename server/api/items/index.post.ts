import { createError, defineEventHandler, readBody } from 'h3'
import { ownedBike } from '../../utils/owned'
import { createItem } from '../../utils/bikes'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  if (typeof body?.bikeId !== 'string') throw createError({ statusCode: 400, statusMessage: 'Invalid bikeId' })
  return createItem(await ownedBike(event, body.bikeId), body)
})
