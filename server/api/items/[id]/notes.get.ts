import { defineEventHandler, getRouterParam } from 'h3'
import { listNotes } from '../../../utils/item-notes'
import { ownedItem } from '../../../utils/owned'

export default defineEventHandler(async (event) => listNotes(await ownedItem(event, getRouterParam(event, 'id') ?? '')))
