import { createError, defineEventHandler, getHeader, getRouterParam, readMultipartFormData } from 'h3'
import { addNotePhoto } from '../../../utils/item-notes'
import { ownedNote } from '../../../utils/owned'
import { assertContentLength } from '../../../utils/upload-guard'

/** One photo per request (multipart: clientId, file). The client downscales it to JPEG first. */
export default defineEventHandler(async (event) => {
  const note = await ownedNote(event, getRouterParam(event, 'id') ?? '')
  assertContentLength(getHeader(event, 'content-length'))
  const parts = (await readMultipartFormData(event)) ?? []
  if (parts.length > 3) throw createError({ statusCode: 400, statusMessage: 'One photo per upload.' })
  const file = parts.find((p) => p.name === 'file' && p.data.length)
  if (!file) throw createError({ statusCode: 400, statusMessage: 'File missing' })
  const clientId = parts.find((p) => p.name === 'clientId')?.data.toString('utf8').trim()
  return addNotePhoto(note, { clientId, mime: file.type, data: Buffer.from(file.data) })
})
