import { createError, defineEventHandler, getRouterParam } from 'h3'
import { deleteNotePhoto } from '../../../../utils/item-notes'
import { ownedNote } from '../../../../utils/owned'
import { isUuid } from '../../../../utils/validate'

export default defineEventHandler(async (event) => {
  const note = await ownedNote(event, getRouterParam(event, 'id') ?? '')
  const photoId = getRouterParam(event, 'photoId') ?? ''
  if (!isUuid(photoId)) throw createError({ statusCode: 404, statusMessage: 'Not found' })
  return deleteNotePhoto(note, photoId)
})
