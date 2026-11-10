import { defineEventHandler, getRouterParam } from 'h3'
import { ownedDocument } from '../../../utils/owned'
import { readerConfigFor, requestRead } from '../../../utils/invoice-read'

/** Start reading in the background; the client polls GET /api/documents/:id. Counts toward the read caps. */
export default defineEventHandler(async (event) => {
  const doc = await ownedDocument(event, getRouterParam(event, 'id') ?? '')
  const { status, error } = await requestRead(doc, await readerConfigFor(event, doc.userId))
  return { id: doc.id, status, error }
})
