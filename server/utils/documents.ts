import { createHash } from 'node:crypto'
import { and, eq, gt, inArray, ne, sql } from 'drizzle-orm'
import { createError } from 'h3'
import { db } from '../db/client'
import { documentFiles, documents } from '../db/schema'
import { parseInvoiceQrResult } from '../../app/lib/qr-invoice'
import { DAY_MS, rateLimit } from './rate-limit'

export type UploadInput = {
  files: Array<{ type?: string; data: Buffer }>
  qrRaw: string | null
  clientId: string | null
}
export type UploadResult = { id: string; duplicate: boolean; status: 'reading' | 'manual' | 'review' | 'confirmed'; qrNotice?: string }

/** Open registration: one account must not be able to fill the disk. */
export const UPLOADS_PER_DAY = 30
export const MAX_UNCONFIRMED = 20
export const UPLOAD_DAILY_COPY = 'Upload limit reached for today — try again tomorrow.'
export const UNCONFIRMED_COPY = `You have ${MAX_UNCONFIRMED} invoices waiting for review — confirm or discard some first.`

/**
 * 429 when the user already has MAX_UNCONFIRMED documents waiting, or made
 * UPLOADS_PER_DAY in the last 24 h. Counted in Postgres (survives restarts);
 * the in-memory window on top means discarding uploads doesn't give them back.
 */
export async function assertUploadAllowed(userId: string, now = Date.now()) {
  const since = new Date(now - DAY_MS)
  const [c] = await db
    .select({
      today: sql<number>`count(*) filter (where ${gt(documents.createdAt, since)})::int`,
      waiting: sql<number>`count(*) filter (where ${ne(documents.status, 'confirmed')})::int`,
    })
    .from(documents)
    .where(eq(documents.userId, userId))
  if ((c?.waiting ?? 0) >= MAX_UNCONFIRMED) throw createError({ statusCode: 429, statusMessage: UNCONFIRMED_COPY })
  if ((c?.today ?? 0) >= UPLOADS_PER_DAY || rateLimit(`upload-day:${userId}`, UPLOADS_PER_DAY, DAY_MS, now) !== null) {
    throw createError({ statusCode: 429, statusMessage: UPLOAD_DAILY_COPY })
  }
}

const isUniqueViolation = (err: unknown) => {
  const e = err as { code?: string; cause?: { code?: string } }
  return e?.code === '23505' || e?.cause?.code === '23505'
}

async function existing(userId: string, shas: string[], clientId: string | null) {
  const [bySha] = await db
    .select({ id: documents.id, status: documents.status })
    .from(documentFiles)
    .innerJoin(documents, eq(documentFiles.documentId, documents.id))
    .where(and(eq(documentFiles.userId, userId), inArray(documentFiles.sha256, shas)))
  if (bySha) return { ...bySha, duplicate: true }
  if (clientId) {
    const [replay] = await db
      .select({ id: documents.id, status: documents.status })
      .from(documents)
      .where(and(eq(documents.userId, userId), eq(documents.clientId, clientId)))
    if (replay) return { ...replay, duplicate: false }
  }
  return null
}

/**
 * Store an uploaded invoice (files already validated). Any page this user
 * already uploaded → that document, nothing new; a replayed clientId → the same.
 * A QR of another document type (receipt, proforma…) never blocks the upload:
 * the photos are kept without QR fields and the reason comes back as a notice.
 */
export async function saveDocument(userId: string, input: UploadInput, readingAvailable: boolean): Promise<UploadResult> {
  const { qr, reason } = input.qrRaw ? parseInvoiceQrResult(input.qrRaw) : { qr: null, reason: undefined }
  const notice = reason ? { qrNotice: reason } : {}

  // The same photo picked twice is one page, not a conflict.
  const seen = new Set<string>()
  const pages = input.files
    .map((f) => ({ ...f, sha256: createHash('sha256').update(f.data).digest('hex') }))
    .filter((d) => (seen.has(d.sha256) ? false : (seen.add(d.sha256), true)))
    .map((d, i) => ({ ...d, page: i + 1 }))
  const shas = pages.map((p) => p.sha256)

  const before = await existing(userId, shas, input.clientId)
  if (before) return { id: before.id, duplicate: before.duplicate, status: before.status, ...notice }
  await assertUploadAllowed(userId)

  const status = readingAvailable ? 'reading' : 'manual'
  try {
    const id = await db.transaction(async (tx) => {
      const [doc] = await tx
        .insert(documents)
        .values({
          userId,
          clientId: input.clientId,
          status,
          qrRaw: qr ? input.qrRaw : null,
          ...(qr ? { supplierNif: qr.supplierNif, number: qr.number, issuedAt: qr.issuedAt, totalCents: qr.totalCents } : {}),
        })
        .returning({ id: documents.id })
      await tx.insert(documentFiles).values(pages.map((p) => ({ documentId: doc!.id, userId, page: p.page, mime: p.type!, bytes: p.data, sha256: p.sha256 })))
      return doc!.id
    })
    return { id, duplicate: false, status, ...notice }
  } catch (err) {
    // Lost a race on (userId, sha256) or (userId, clientId): the winner's document is this upload.
    if (!isUniqueViolation(err)) throw err
    const winner = await existing(userId, shas, input.clientId)
    if (!winner) throw err
    return { id: winner.id, duplicate: true, status: winner.status, ...notice }
  }
}
