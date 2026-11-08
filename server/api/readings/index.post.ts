import { createError, defineEventHandler, readBody, setResponseStatus } from 'h3'
import { ownedBike } from '../../utils/owned'
import { logReading } from '../../utils/readings'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  if (typeof body?.bikeId !== 'string') throw createError({ statusCode: 400, statusMessage: 'Invalid bikeId' })
  const result = await logReading(await ownedBike(event, body.bikeId), body)
  if (result.status !== 200) setResponseStatus(event, result.status)
  return result.body
})
