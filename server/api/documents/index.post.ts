import { createHash } from 'node:crypto'
import { and, eq, inArray } from 'drizzle-orm'
import { createError, defineEventHandler, getHeader, readMultipartFormData } from 'h3'
import { db } from '../../db/client'
import { documentFiles, documents } from '../../db/schema'
import { requireUser } from '../../utils/require-user'
import { assertContentLength, MAX_PARTS, validateUploadFiles } from '../../utils/upload-guard'
import { parseInvoiceQrResult } from '../../../app/lib/qr-invoice'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Upload an invoice (<= 5 photos or one PDF). Reading itself is Task 9's job. */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  assertContentLength(getHeader(event, 'content-length'))
  const parts = ((await readMultipartFormData(event)) ?? []).map((p) => ({ ...p, data: Buffer.from(p.data) }))
  if (parts.length > MAX_PARTS) throw createError({ statusCode: 400, statusMessage: 'At most 5 photos per invoice.' })
  const files = parts.filter((p) => p.name === 'files' && p.data.length)
  validateUploadFiles(files)

  const field = (name: string) => parts.find((p) => p.name === name)?.data.toString('utf8').trim() ?? ''
  const qrRaw = field('qrRaw').slice(0, 2000) || null
  const clientIdRaw = field('clientId')
  const clientId = UUID.test(clientIdRaw) ? clientIdRaw : null
  const { qr, reason } = qrRaw ? parseInvoiceQrResult(qrRaw) : { qr: null, reason: undefined }
  if (reason) throw createError({ statusCode: 422, statusMessage: reason })

  // The same photo picked twice is one page, not a conflict.
  const seen = new Set<string>()
  const pages = files
    .map((f) => ({ ...f, sha256: createHash('sha256').update(f.data).digest('hex') }))
    .filter((d) => (seen.has(d.sha256) ? false : (seen.add(d.sha256), true)))
    .map((d, i) => ({ ...d, page: i + 1 }))

  // Any page already uploaded by this user -> that document, nothing new.
  const [existing] = await db
    .select({ documentId: documentFiles.documentId })
    .from(documentFiles)
    .where(and(eq(documentFiles.userId, user.id), inArray(documentFiles.sha256, pages.map((p) => p.sha256))))
  if (existing) return { id: existing.documentId, duplicate: true }

  if (clientId) {
    const [replay] = await db.select({ id: documents.id }).from(documents).where(and(eq(documents.userId, user.id), eq(documents.clientId, clientId)))
    if (replay) return { id: replay.id, duplicate: false }
  }

  const reading = !!useRuntimeConfig(event).openrouterApiKey
  const id = await db.transaction(async (tx) => {
    const [doc] = await tx
      .insert(documents)
      .values({
        userId: user.id,
        clientId,
        status: reading ? 'reading' : 'manual',
        qrRaw: qr ? qrRaw : null,
        ...(qr ? { supplierNif: qr.supplierNif, number: qr.number, issuedAt: qr.issuedAt, totalCents: qr.totalCents } : {}),
      })
      .returning({ id: documents.id })
    await tx.insert(documentFiles).values(
      pages.map((p) => ({ documentId: doc!.id, userId: user.id, page: p.page, mime: p.type!, bytes: p.data, sha256: p.sha256 })),
    )
    return doc!.id
  })
  return { id, duplicate: false }
})
