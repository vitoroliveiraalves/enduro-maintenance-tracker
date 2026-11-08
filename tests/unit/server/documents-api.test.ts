import { beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { db } from '../../../server/db/client'
import { documentFiles, documents, user } from '../../../server/db/schema'
import { MAX_UNCONFIRMED, saveDocument, UNCONFIRMED_COPY, UPLOAD_DAILY_COPY, UPLOADS_PER_DAY } from '../../../server/utils/documents'
import { truncateUsers } from '../../support/truncate'

vi.mock('../../../server/utils/require-user', () => ({
  requireUser: async (event: { context: { uid?: string } }) => {
    if (!event.context.uid) throw Object.assign(new Error('Unauthorized'), { statusCode: 401 })
    return { id: event.context.uid, email: 'x@example.com' }
  },
}))
vi.stubGlobal('useRuntimeConfig', () => ({ openrouterApiKey: '', openrouterModel: 'm', invoiceReader: '', invoiceDailyCap: 30, invoiceGlobalDailyCap: 300 }))

const jpeg = (n: number) => ({ type: 'image/jpeg', data: Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.from(`page-${n}`)]) })
const RC_QR = 'A:501964843*B:999999990*C:PT*D:RC*E:N*F:20260314*G:RC 2026A/7*H:ABCD1234-7*I1:PT*N:0.00*O:50.00*Q:AbCd*R:1234'
const FT_QR = 'A:501964843*B:999999990*C:PT*D:FT*E:N*F:20260314*G:FT 2026A/0042*H:ABCD1234-42*I1:PT*I7:100.00*I8:23.00*N:23.00*O:123.00*Q:AbCd*R:1234'

let a: string, b: string
beforeEach(async () => {
  await truncateUsers()
  const users = await db.insert(user).values([{ name: 'A', email: 'a@example.com' }, { name: 'B', email: 'b@example.com' }]).returning()
  a = users[0]!.id
  b = users[1]!.id
})

describe('saveDocument', () => {
  it('stores an invoice QR in the header; status reading only when reading is available', async () => {
    const r = await saveDocument(a, { files: [jpeg(1)], qrRaw: FT_QR, clientId: null }, true)
    expect(r).toMatchObject({ duplicate: false, status: 'reading' })
    const [doc] = await db.select().from(documents).where(eq(documents.id, r.id))
    expect(doc).toMatchObject({ supplierNif: '501964843', totalCents: 12300, qrRaw: FT_QR })
    const r2 = await saveDocument(a, { files: [jpeg(2)], qrRaw: null, clientId: null }, false)
    expect(r2.status).toBe('manual')
  })

  it('a non-invoice QR (RC) does not block the upload: image stored, no QR fields, the reason comes back as a notice', async () => {
    const r = await saveDocument(a, { files: [jpeg(1)], qrRaw: RC_QR, clientId: null }, true)
    expect(r.qrNotice).toBe('This QR code is not an invoice (document type RC).')
    const [doc] = await db.select().from(documents).where(eq(documents.id, r.id))
    expect(doc).toMatchObject({ qrRaw: null, supplierNif: null, totalCents: null, number: null })
    expect(await db.select().from(documentFiles).where(eq(documentFiles.documentId, r.id))).toHaveLength(1)
  })

  it('two concurrent uploads of the same photo → one document, the loser gets duplicate:true (no 500 on 23505)', async () => {
    const results = await Promise.all([
      saveDocument(a, { files: [jpeg(7)], qrRaw: null, clientId: null }, false),
      saveDocument(a, { files: [jpeg(7)], qrRaw: null, clientId: null }, false),
      saveDocument(a, { files: [jpeg(7)], qrRaw: null, clientId: null }, false),
    ])
    expect(new Set(results.map((r) => r.id)).size).toBe(1)
    expect(results.filter((r) => !r.duplicate)).toHaveLength(1)
    expect(await db.select().from(documents)).toHaveLength(1)
  })

  it('two concurrent replays of the same clientId with different photos → one document', async () => {
    const clientId = crypto.randomUUID()
    const results = await Promise.all([
      saveDocument(a, { files: [jpeg(8)], qrRaw: null, clientId }, false),
      saveDocument(a, { files: [jpeg(9)], qrRaw: null, clientId }, false),
    ])
    expect(results[0]!.id).toBe(results[1]!.id)
    expect(await db.select().from(documents)).toHaveLength(1)
  })

  it('the same photo from another user is a separate document', async () => {
    const r1 = await saveDocument(a, { files: [jpeg(1)], qrRaw: null, clientId: null }, false)
    const r2 = await saveDocument(b, { files: [jpeg(1)], qrRaw: null, clientId: null }, false)
    expect(r1.id).not.toBe(r2.id)
    expect(r2.duplicate).toBe(false)
  })
})

describe('document endpoints across users', () => {
  const ev = (uid: string, params: Record<string, string>) => ({ context: { uid, params } }) as never

  it('user B gets 404 on user A’s document and its files', async () => {
    const { id } = await saveDocument(a, { files: [jpeg(1)], qrRaw: null, clientId: null }, false)
    const getDoc = (await import('../../../server/api/documents/[id].get')).default
    const getFile = (await import('../../../server/api/documents/[id]/files/[page].get')).default
    await expect(getDoc(ev(b, { id }))).rejects.toMatchObject({ statusCode: 404 })
    await expect(getFile(ev(b, { id, page: '1' }))).rejects.toMatchObject({ statusCode: 404 })
    const mine = (await getDoc(ev(a, { id }))) as { id: string; pages: unknown[] }
    expect(mine.id).toBe(id)
    expect(mine.pages).toHaveLength(1)
  })
})

describe('upload quota (open registration)', () => {
  const save = (uid: string, n: number, clientId: string | null = null) => saveDocument(uid, { files: [jpeg(n)], qrRaw: null, clientId }, false)
  const rejection = async (p: Promise<unknown>) => p.then(() => null, (e: { statusCode?: number; statusMessage?: string }) => [e.statusCode, e.statusMessage])
  const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000)

  it(`${UPLOADS_PER_DAY} uploads in 24 h → 429, older ones and other users don't count; a replay still answers`, async () => {
    expect(UPLOADS_PER_DAY).toBe(30)
    const clientId = crypto.randomUUID()
    await save(a, 0, clientId)
    // 29 more today (confirmed, so the waiting cap is not what trips) + 5 from yesterday.
    await db.insert(documents).values([
      ...Array.from({ length: 29 }, () => ({ userId: a, status: 'confirmed' as const })),
      ...Array.from({ length: 5 }, () => ({ userId: a, status: 'confirmed' as const, createdAt: hoursAgo(25) })),
    ])
    expect(await rejection(save(a, 1))).toEqual([429, UPLOAD_DAILY_COPY])
    expect(UPLOAD_DAILY_COPY).toBe('Upload limit reached for today — try again tomorrow.')
    expect((await save(a, 0, clientId)).duplicate).toBe(true) // same photo again: the existing document
    expect(await rejection(save(b, 2))).toBeNull()
  })

  it(`${MAX_UNCONFIRMED} invoices waiting for review → 429 until some are confirmed or discarded`, async () => {
    expect(MAX_UNCONFIRMED).toBe(20)
    await db.insert(documents).values(Array.from({ length: 20 }, (_, i) => ({ userId: a, status: (['manual', 'review', 'reading'] as const)[i % 3], createdAt: hoursAgo(30) })))
    expect(await rejection(save(a, 1))).toEqual([429, UNCONFIRMED_COPY])
    expect(UNCONFIRMED_COPY).toBe('You have 20 invoices waiting for review — confirm or discard some first.')
    const [one] = await db.select({ id: documents.id }).from(documents).where(eq(documents.userId, a)).limit(1)
    await db.update(documents).set({ status: 'confirmed' }).where(eq(documents.id, one!.id))
    expect(await rejection(save(a, 1))).toBeNull()
  })

  it('discarding does not give the day back (upload, discard, repeat)', async () => {
    for (let i = 0; i < UPLOADS_PER_DAY; i++) {
      const r = await save(a, 100 + i)
      await db.delete(documents).where(eq(documents.id, r.id))
    }
    expect(await rejection(save(a, 999))).toEqual([429, UPLOAD_DAILY_COPY])
  })
})
