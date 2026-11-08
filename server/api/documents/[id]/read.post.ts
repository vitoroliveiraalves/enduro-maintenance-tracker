import { defineEventHandler, getRouterParam } from 'h3'
import { ownedDocument } from '../../../utils/owned'
import { readerConfig, requestRead } from '../../../utils/invoice-read'

/** Start reading in the background; the client polls GET /api/documents/:id. Counts toward the read caps. */
export default defineEventHandler(async (event) => {
  const doc = await ownedDocument(event, getRouterParam(event, 'id') ?? '')
  const { status, error } = await requestRead(doc, readerConfig(event))
  return { id: doc.id, status, error }
})
