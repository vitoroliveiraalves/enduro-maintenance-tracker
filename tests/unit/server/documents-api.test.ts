import { beforeEach, describe, expect, it, vi } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { db } from '../../../server/db/client'
import { documentFiles, documents, user } from '../../../server/db/schema'
import { saveDocument } from '../../../server/utils/documents'

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
  await db.execute(sql`TRUNCATE "user" CASCADE`)
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
