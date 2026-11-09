import { defineEventHandler, getRouterParam, readBody } from 'h3'
import { createNote } from '../../../utils/item-notes'
import { ownedItem } from '../../../utils/owned'

/** New note on an item: { clientId, title, body?, specs?: [{ label, value }] }. Photos follow, one per request. */
export default defineEventHandler(async (event) => createNote(await ownedItem(event, getRouterParam(event, 'id') ?? ''), await readBody(event)))
