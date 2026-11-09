import { defineEventHandler, getRouterParam } from 'h3'
import { deleteNote } from '../../utils/item-notes'
import { ownedNote } from '../../utils/owned'

export default defineEventHandler(async (event) => deleteNote(await ownedNote(event, getRouterParam(event, 'id') ?? '')))
