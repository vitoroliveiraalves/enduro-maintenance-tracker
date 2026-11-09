import { defineEventHandler, getRouterParam } from 'h3'
import { ownedDocument } from '../../utils/owned'
import { deleteDocument } from '../../utils/invoice-confirm'

/** Delete an invoice of any status; a saved one takes everything it created with it. */
export default defineEventHandler(async (event) => {
  await deleteDocument(await ownedDocument(event, getRouterParam(event, 'id') ?? ''))
  return { ok: true }
})
