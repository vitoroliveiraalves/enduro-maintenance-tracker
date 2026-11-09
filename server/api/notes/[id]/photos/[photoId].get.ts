import { createError, defineEventHandler, getRouterParam, setHeader } from 'h3'
import { notePhoto } from '../../../../utils/item-notes'
import { ownedNote } from '../../../../utils/owned'
import { isUuid } from '../../../../utils/validate'

// The photo, inline. Private: ownership is checked through the note.
export default defineEventHandler(async (event) => {
  const note = await ownedNote(event, getRouterParam(event, 'id') ?? '')
  const photoId = getRouterParam(event, 'photoId') ?? ''
  const photo = isUuid(photoId) ? await notePhoto(note, photoId) : null
  if (!photo) throw createError({ statusCode: 404, statusMessage: 'Not found' })
  setHeader(event, 'Content-Type', photo.mime)
  setHeader(event, 'X-Content-Type-Options', 'nosniff')
  // A photo never changes once stored (a new one gets a new id): let the browser keep it.
  setHeader(event, 'Cache-Control', 'private, max-age=31536000, immutable')
  return photo.bytes
})
