import { defineEventHandler, getRouterParam, readBody } from 'h3'
import { patchNote } from '../../utils/item-notes'
import { ownedNote } from '../../utils/owned'

export default defineEventHandler(async (event) => patchNote(await ownedNote(event, getRouterParam(event, 'id') ?? ''), await readBody(event)))
