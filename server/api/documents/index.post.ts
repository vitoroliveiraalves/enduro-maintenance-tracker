import { createError, defineEventHandler, getHeader, readMultipartFormData } from 'h3'
import { requireUser } from '../../utils/require-user'
import { saveDocument } from '../../utils/documents'
import { readerConfig, readingAvailable } from '../../utils/invoice-read'
import { assertContentLength, MAX_PARTS, validateUploadFiles } from '../../utils/upload-guard'
import { isUuid } from '../../utils/validate'

/** Upload an invoice (<= 5 photos or one PDF). The client then starts reading with POST /:id/read. */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  assertContentLength(getHeader(event, 'content-length'))
  const parts = ((await readMultipartFormData(event)) ?? []).map((p) => ({ ...p, data: Buffer.from(p.data) }))
  if (parts.length > MAX_PARTS) throw createError({ statusCode: 400, statusMessage: 'At most 5 photos per invoice.' })
  const files = parts.filter((p) => p.name === 'files' && p.data.length)
  validateUploadFiles(files)

  const field = (name: string) => parts.find((p) => p.name === name)?.data.toString('utf8').trim() ?? ''
  const clientIdRaw = field('clientId')
  return saveDocument(
    user.id,
    { files, qrRaw: field('qrRaw').slice(0, 2000) || null, clientId: isUuid(clientIdRaw) ? clientIdRaw : null },
    readingAvailable(readerConfig(event)),
  )
})
