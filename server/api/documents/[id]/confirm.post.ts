import { createError, defineEventHandler, getRouterParam, readBody, setResponseStatus } from 'h3'
import { ownedBike, ownedDocument } from '../../../utils/owned'
import { confirmInvoice } from '../../../utils/invoice-confirm'

export default defineEventHandler(async (event) => {
  const doc = await ownedDocument(event, getRouterParam(event, 'id') ?? '')
  const body = await readBody(event)
  if (typeof body?.bikeId !== 'string') throw createError({ statusCode: 400, statusMessage: 'Pick a bike' })
  const result = await confirmInvoice(doc, await ownedBike(event, body.bikeId), body)
  if (result.status !== 200) setResponseStatus(event, result.status)
  return result.body
})
