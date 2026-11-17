import { createError, defineEventHandler, getHeader, getRouterParam, readMultipartFormData } from 'h3'
import { addManual } from '../../../utils/manuals'
import { ownedBike } from '../../../utils/owned'
import { assertContentLength, MAX_MANUAL_REQUEST_BYTES } from '../../../utils/upload-guard'

export default defineEventHandler(async (event) => {
  const bike = await ownedBike(event, getRouterParam(event, 'id') ?? '')
  assertContentLength(getHeader(event, 'content-length'), MAX_MANUAL_REQUEST_BYTES, 'File too large (50 MB max).')
  const parts = (await readMultipartFormData(event)) ?? []
  if (parts.length > 6) throw createError({ statusCode: 400, statusMessage: 'One PDF per upload.' })
  const file = parts.find((p) => p.name === 'file' && p.data.length)
  if (!file) throw createError({ statusCode: 400, statusMessage: 'File missing' })
  const field = (name: string) => parts.find((p) => p.name === name)?.data.toString('utf8').trim()
  return addManual(bike, {
    clientId: field('clientId'),
    kind: field('kind'),
    title: field('title'),
    fileName: file.filename,
    mime: file.type,
    data: Buffer.from(file.data),
  })
})
