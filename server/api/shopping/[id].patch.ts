import { defineEventHandler, getRouterParam, readBody } from 'h3'
import { ownedShoppingEntry } from '../../utils/owned'
import { entryRow, patchEntry } from '../../utils/shopping'

export default defineEventHandler(async (event) => {
  const entry = await ownedShoppingEntry(event, getRouterParam(event, 'id') ?? '')
  await patchEntry(entry, await readBody(event))
  return entryRow(entry.userId, entry.id)
})
