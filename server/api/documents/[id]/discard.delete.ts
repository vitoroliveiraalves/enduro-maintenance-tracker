import { defineEventHandler, getRouterParam } from 'h3'
import { ownedDocument } from '../../../utils/owned'
import { discardDocument } from '../../../utils/invoice-confirm'

export default defineEventHandler(async (event) => {
  await discardDocument(await ownedDocument(event, getRouterParam(event, 'id') ?? ''))
  return { ok: true }
})
