import { beforeEach, describe, expect, it, vi } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { db } from '../../../server/db/client'
import { documentFiles, documents, user } from '../../../server/db/schema'
import type { Document } from '../../../server/db/schema'
import { flipIfStuck, requestRead, STUCK_MS } from '../../../server/utils/invoice-read'

const MANUAL_NO_KEY = 'Automatic reading is not set up on this server.'
const cfg = { apiKey: 'sk-or-test', model: 'google/gemini-3.1-flash-lite', reader: '', dailyCap: 30 }
const modelJson = {
  readable: true,
  supplierName: 'Moto Garage Braga, Lda',
  supplierNif: '123456789',
  number: 'FT AI/1',
  issuedAt: '2026-11-01',
  pricesIncludeVat: true,
  total: 215.4,
  lines: [
    { description: 'Pneu Michelin Enduro Medium 140/80-18', kind: 'tyre', qty: 1, unitPrice: 129, lineTotal: 129, vatRate: 23 },
    { description: 'Mão de obra', kind: 'labour', qty: 1, unitPrice: 30, lineTotal: 30, vatRate: 23 },
    { description: '', kind: 'part', qty: 1, unitPrice: 1, lineTotal: 1, vatRate: 23 },
  ],
}
const okFetch = () =>
  vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(modelJson) } }], usage: { cost: 0.002 } }), { status: 200 }))

let uid: string
let seq = 0
async function makeDoc(over: Partial<typeof documents.$inferInsert> = {}, bytes = Buffer.from([0xff, 0xd8, 0xff, 1, 2, 3])): Promise<Document> {
  const [doc] = await db.insert(documents).values({ userId: uid, status: 'reading', ...over }).returning()
  await db.insert(documentFiles).values({ documentId: doc!.id, userId: uid, page: 1, mime: 'image/jpeg', bytes, sha256: `sha-${++seq}` })
  return doc!
}
const reload = async (id: string) => (await db.select().from(documents).where(eq(documents.id, id)))[0]!
const fileCount = async (id: string) => (await db.select().from(documentFiles).where(eq(documentFiles.documentId, id))).length

beforeEach(async () => {
  await db.execute(sql`TRUNCATE "user" CASCADE`)
  const [u] = await db.insert(user).values({ name: 'A', email: `a${Math.random()}@example.com` }).returning()
  uid = u!.id
})

describe('requestRead', () => {
  it('reads in the background: status reading, then review with lines in cents and usage kept', async () => {
    const doc = await makeDoc()
    const fetchImpl = okFetch()
    const r = await requestRead(doc, cfg, { fetchImpl: fetchImpl as unknown as typeof fetch })
    expect(r.status).toBe('reading')
    expect((await reload(doc.id)).status).toBe('reading')
    await r.done
    const after = await reload(doc.id)
    expect(after.status).toBe('review')
    expect(after.error).toBeNull()
    const ex = after.extracted as { lines: Array<{ description: string; totalCents: number }>; meta: { usage: { cost: number } } }
    expect(ex.lines.map((l) => [l.description, l.totalCents])).toEqual([
      ['Pneu Michelin Enduro Medium 140/80-18', 12900],
      ['Mão de obra', 3000],
    ])
    expect(ex.meta.usage.cost).toBe(0.002)
    // no QR: the AI header fills the document
    expect(after).toMatchObject({ supplierName: 'Moto Garage Braga, Lda', supplierNif: '123456789', number: 'FT AI/1', issuedAt: '2026-11-01', totalCents: 21540 })
  })

  it('QR fields win over the AI header', async () => {
    const doc = await makeDoc({ qrRaw: 'A:501964843*…', supplierNif: '501964843', number: 'FT 2026A/0042', issuedAt: '2026-03-14', totalCents: 12300 })
    const r = await requestRead(doc, cfg, { fetchImpl: okFetch() as unknown as typeof fetch })
    await r.done
    expect(await reload(doc.id)).toMatchObject({
      status: 'review', supplierName: 'Moto Garage Braga, Lda', supplierNif: '501964843', number: 'FT 2026A/0042', issuedAt: '2026-03-14', totalCents: 12300,
    })
  })

  // Review Focus 4
  it.each([
    ['HTTP 500', async () => new Response('boom', { status: 500 })],
    ['prose instead of JSON', async () => new Response(JSON.stringify({ choices: [{ message: { content: 'I think it is a tyre.' } }] }), { status: 200 })],
    ['a network error', async () => Promise.reject(new TypeError('fetch failed'))],
  ])('%s → manual with a reason; images kept; nothing invented', async (_l, impl) => {
    const doc = await makeDoc()
    const r = await requestRead(doc, cfg, { fetchImpl: vi.fn(impl) as unknown as typeof fetch })
    await r.done
    const after = await reload(doc.id)
    expect(after.status).toBe('manual')
    expect(after.error).toBeTruthy()
    expect(after.extracted).toBeNull()
    expect(await fileCount(doc.id)).toBe(1)
  })

  it('an unexpected crash inside the reader still ends in manual (fire-and-forget has its own error handling)', async () => {
    const doc = await makeDoc()
    const r = await requestRead(doc, cfg, { fetchImpl: (() => { throw new Error('kaboom') }) as unknown as typeof fetch })
    await r.done
    expect((await reload(doc.id)).status).toBe('manual')
  })

  it('no key → manual at once, no network call', async () => {
    const doc = await makeDoc()
    const fetchImpl = vi.fn()
    const r = await requestRead(doc, { ...cfg, apiKey: '' }, { fetchImpl: fetchImpl as unknown as typeof fetch })
    await r.done
    expect(r.status).toBe('manual')
    expect(await reload(doc.id)).toMatchObject({ status: 'manual', error: MANUAL_NO_KEY })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('mock reader: 3 lines; MOCK-FAIL in the file or mock-fail mode → manual', async () => {
    const ok = await makeDoc()
    await (await requestRead(ok, { ...cfg, apiKey: '', reader: 'mock' })).done
    const ex = (await reload(ok.id)).extracted as { lines: Array<{ description: string; totalCents: number; kind: string }> }
    expect(ex.lines).toEqual([
      expect.objectContaining({ description: 'Pneu Michelin Enduro Medium 140/80-18', totalCents: 12900, kind: 'tyre' }),
      expect.objectContaining({ description: 'Mão de obra', totalCents: 3000, kind: 'labour' }),
      expect.objectContaining({ description: 'Rolamentos roda traseira', totalCents: 5640, kind: 'part' }),
    ])
    const bad = await makeDoc({}, Buffer.from('%PDF-1.4 MOCK-FAIL'))
    await (await requestRead(bad, { ...cfg, apiKey: '', reader: 'mock' })).done
    expect((await reload(bad.id)).status).toBe('manual')
    const failMode = await makeDoc()
    await (await requestRead(failMode, { ...cfg, apiKey: '', reader: 'mock-fail' })).done
    expect((await reload(failMode.id)).status).toBe('manual')
  })

  it('daily cap reached → 429 with the copy, document goes manual with that reason', async () => {
    const capped = { ...cfg, apiKey: '', reader: 'mock', dailyCap: 2 }
    for (let i = 0; i < 2; i++) await (await requestRead(await makeDoc(), capped)).done
    const third = await makeDoc()
    await expect(requestRead(third, capped)).rejects.toMatchObject({
      statusCode: 429,
      statusMessage: 'Daily invoice reading limit reached — you can still add the lines yourself.',
    })
    expect(await reload(third.id)).toMatchObject({ status: 'manual', error: 'Daily invoice reading limit reached — you can still add the lines yourself.' })
  })

  it('a confirmed document cannot be read again (409)', async () => {
    const doc = await makeDoc({ status: 'confirmed' })
    await expect(requestRead(doc, cfg)).rejects.toMatchObject({ statusCode: 409 })
  })
})

describe('flipIfStuck', () => {
  it(`reading older than ${STUCK_MS / 1000} s → manual; newer stays reading`, async () => {
    const now = Date.now()
    const old = await makeDoc()
    await db.execute(sql`update documents set updated_at = ${new Date(now - STUCK_MS - 1000).toISOString()} where id = ${old.id}`)
    const fresh = await makeDoc()
    expect((await flipIfStuck(await reload(old.id), new Date(now))).status).toBe('manual')
    expect((await reload(old.id)).error).toMatch(/took too long/)
    expect((await flipIfStuck(await reload(fresh.id), new Date(now))).status).toBe('reading')
  })
})
