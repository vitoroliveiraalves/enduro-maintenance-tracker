import { and, eq } from 'drizzle-orm'
import { createError, defineEventHandler, getRouterParam, setHeader } from 'h3'
import { db } from '../../../../db/client'
import { documentFiles } from '../../../../db/schema'
import { ownedDocument } from '../../../../utils/owned'

// The original page, inline, never cached. Ownership is checked through the document.
export default defineEventHandler(async (event) => {
  const doc = await ownedDocument(event, getRouterParam(event, 'id') ?? '')
  const page = Number(getRouterParam(event, 'page'))
  if (!Number.isInteger(page) || page < 1) throw createError({ statusCode: 404, statusMessage: 'Not found' })
  const [file] = await db
    .select({ mime: documentFiles.mime, bytes: documentFiles.bytes })
    .from(documentFiles)
    .where(and(eq(documentFiles.documentId, doc.id), eq(documentFiles.userId, doc.userId), eq(documentFiles.page, page)))
  if (!file) throw createError({ statusCode: 404, statusMessage: 'Not found' })
  const ext = file.mime === 'application/pdf' ? 'pdf' : file.mime === 'image/png' ? 'png' : 'jpg'
  setHeader(event, 'Content-Type', file.mime)
  setHeader(event, 'X-Content-Type-Options', 'nosniff')
  setHeader(event, 'Content-Disposition', `inline; filename="invoice-${page}.${ext}"`)
  setHeader(event, 'Cache-Control', 'private, no-store')
  return file.bytes
})
