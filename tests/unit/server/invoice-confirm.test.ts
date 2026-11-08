import { beforeEach, describe, expect, it } from 'vitest'
import { asc, eq, sql } from 'drizzle-orm'
import { db } from '../../../server/db/client'
import { categories, documentFiles, documents, expenseItems, expenses, serviceItems, services, user } from '../../../server/db/schema'
import type { Document } from '../../../server/db/schema'
import { DEFAULT_CATEGORIES } from '../../../server/utils/categories-seed'
import { createBike, itemRows } from '../../../server/utils/bikes'
import { confirmInvoice, discardDocument } from '../../../server/utils/invoice-confirm'

let uid: string, other: string
let bike: Awaited<ReturnType<typeof createBike>>
let cat: Record<string, string>
let bearings: string, gearbox: string

const day = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString().slice(0, 10)

async function makeDoc(over: Partial<typeof documents.$inferInsert> = {}): Promise<Document> {
  const [doc] = await db.insert(documents).values({ userId: uid, status: 'review', ...over }).returning()
  await db.insert(documentFiles).values({ documentId: doc!.id, userId: uid, page: 1, mime: 'image/jpeg', bytes: Buffer.from([0xff, 0xd8, 0xff]), sha256: crypto.randomUUID() })
  return doc!
}
const mixedLines = () => [
  { description: 'Pneu Michelin Enduro Medium 140/80-18', amountCents: 12900, categoryId: cat.tyres, itemIds: [] },
  { description: 'Mão de obra', amountCents: 3000, categoryId: cat.labour, itemIds: [] },
  { description: 'Rolamentos roda traseira', amountCents: 5640, categoryId: cat.maintenance, itemIds: [bearings] },
]
const body = (over: Record<string, unknown> = {}) => ({
  clientId: crypto.randomUUID(), bikeId: bike.id, at: day(3), hoursTenths: 1400, km: 3790, garageName: 'Moto Garage Braga', lines: mixedLines(), ...over,
})
const reload = async (id: string) => (await db.select().from(documents).where(eq(documents.id, id)))[0]

beforeEach(async () => {
  await db.execute(sql`TRUNCATE "user" CASCADE`)
  const [u, o] = await db.insert(user).values([{ name: 'A', email: 'a@example.com' }, { name: 'B', email: 'b@example.com' }]).returning()
  uid = u!.id
  other = o!.id
  await db.insert(categories).values(DEFAULT_CATEGORIES.map((c) => ({ ...c, userId: uid })))
  const cats = await db.select().from(categories).where(eq(categories.userId, uid))
  cat = Object.fromEntries(cats.map((c) => [c.kind, c.id]))
  bike = await createBike(uid, {
    clientId: crypto.randomUUID(), name: 'KTM', make: 'KTM', model: '300', year: 2022, stroke: '2T', hoursTenths: 1420, km: 3800,
    items: [
      { name: 'Gearbox oil', everyHoursTenths: 150, lastDone: { at: day(100), hoursTenths: 1000, km: 3000 } },
      { name: 'Wheel bearings', everyHoursTenths: 500 },
    ],
  })
  const rows = await itemRows(bike.id, uid)
  bearings = rows.find((r) => r.name === 'Wheel bearings')!.id
  gearbox = rows.find((r) => r.name === 'Gearbox oil')!.id
})

describe('confirmInvoice', () => {
  it('mixed invoice → 3 expenses (tyres/labour/maintenance) and one garage service resetting Wheel bearings', async () => {
    const doc = await makeDoc({ totalCents: 21540 })
    const res = await confirmInvoice(doc, bike, body())
    expect(res.status).toBe(200)

    const exps = await db
      .select({ e: expenses, kind: categories.kind })
      .from(expenses)
      .innerJoin(categories, eq(expenses.categoryId, categories.id))
      .orderBy(asc(expenses.documentLine))
    expect(exps.map((x) => [x.e.documentLine, x.e.amountCents, x.kind, x.e.description])).toEqual([
      [1, 12900, 'tyres', 'Pneu Michelin Enduro Medium 140/80-18'],
      [2, 3000, 'labour', 'Mão de obra'],
      [3, 5640, 'maintenance', 'Rolamentos roda traseira'],
    ])
    expect(exps.every((x) => x.e.documentId === doc.id && x.e.bikeId === bike.id && x.e.at === day(3))).toBe(true)

    const svcs = await db.select().from(services).where(eq(services.documentId, doc.id))
    expect(svcs).toHaveLength(1)
    expect(svcs[0]).toMatchObject({ by: 'garage', garageName: 'Moto Garage Braga', at: day(3), hoursTenths: 1400, km: 3790 })
    expect(exps.every((x) => x.e.serviceId === svcs[0]!.id)).toBe(true)
    const links = await db.select().from(serviceItems).where(eq(serviceItems.serviceId, svcs[0]!.id))
    expect(links.map((l) => l.itemId)).toEqual([bearings])
    const exLinks = await db.select().from(expenseItems)
    expect(exLinks.map((l) => [l.expenseId, l.itemId])).toEqual([[exps[2]!.e.id, bearings]])

    const row = (await itemRows(bike.id, uid)).find((r) => r.id === bearings)!
    expect(row.status.state).toBe('ok')
    expect(row.last).toMatchObject({ by: 'garage', garageName: 'Moto Garage Braga' })
    expect(await reload(doc.id)).toMatchObject({ status: 'confirmed', supplierName: 'Moto Garage Braga', issuedAt: day(3) })
  })

  it('the service links the union of every line’s items', async () => {
    const doc = await makeDoc()
    await confirmInvoice(doc, bike, body({
      lines: [
        { description: 'Óleo', amountCents: 1500, categoryId: cat.maintenance, itemIds: [gearbox] },
        { description: 'Rolamentos', amountCents: 5640, categoryId: cat.maintenance, itemIds: [bearings, gearbox] },
      ],
    }))
    const [svc] = await db.select().from(services).where(eq(services.documentId, doc.id))
    const links = await db.select().from(serviceItems).where(eq(serviceItems.serviceId, svc!.id))
    expect(links.map((l) => l.itemId).sort()).toEqual([bearings, gearbox].sort())
  })

  it('no line linked to an item → expenses only, no service', async () => {
    const doc = await makeDoc()
    await confirmInvoice(doc, bike, body({ lines: mixedLines().slice(0, 2) }))
    expect(await db.select().from(services).where(eq(services.documentId, doc.id))).toHaveLength(0)
    const exps = await db.select().from(expenses)
    expect(exps).toHaveLength(2)
    expect(exps.every((e) => e.serviceId === null)).toBe(true)
  })

  it('totals mismatch beyond max(50 cents, 1 %) → 409 with diffCents, nothing written; forceTotals saves', async () => {
    const doc = await makeDoc({ totalCents: 20000 })
    const res = await confirmInvoice(doc, bike, body())
    expect(res).toEqual({ status: 409, body: { error: 'totals-mismatch', diffCents: 1540 } })
    expect(await db.select().from(expenses)).toHaveLength(0)
    expect((await reload(doc.id))!.status).toBe('review')
    expect((await confirmInvoice(doc, bike, body({ forceTotals: true }))).status).toBe(200)
    expect(await db.select().from(expenses)).toHaveLength(3)
  })

  it('within tolerance passes; no total skips the check; the 1 % applies on big invoices', async () => {
    expect((await confirmInvoice(await makeDoc({ totalCents: 21500 }), bike, body())).status).toBe(200) // 40 cents off
    expect((await confirmInvoice(await makeDoc({ totalCents: null }), bike, body())).status).toBe(200)
    // 1 % of 215,40 is 2,15 -> 2,00 off passes
    expect((await confirmInvoice(await makeDoc({ totalCents: 21340 }), bike, body())).status).toBe(200)
    expect((await confirmInvoice(await makeDoc({ totalCents: 21300 }), bike, body())).status).toBe(409)
  })

  it('a confirmed document cannot be confirmed again (409)', async () => {
    const doc = await makeDoc()
    await confirmInvoice(doc, bike, body())
    await expect(confirmInvoice(doc, bike, body())).rejects.toMatchObject({ statusCode: 409 })
    expect(await db.select().from(expenses)).toHaveLength(3)
  })

  it('bad input is a 400 and writes nothing (transactional, same validation as services/expenses)', async () => {
    const [foreignCat] = await db.insert(categories).values({ userId: other, name: 'X', kind: 'other' }).returning()
    const doc = await makeDoc()
    const bads: Array<Record<string, unknown>> = [
      { lines: [] },
      { lines: [...mixedLines(), { description: 'x', amountCents: 100, categoryId: foreignCat!.id, itemIds: [] }] },
      { lines: [{ ...mixedLines()[2]!, amountCents: 0 }] },
      { lines: [{ ...mixedLines()[2]!, itemIds: ['00000000-0000-4000-8000-000000000000'] }] },
      { hoursTenths: 1500 }, // above the bike's current 142.0 h
      { at: '2026-13-45' },
      { at: day(-5) },
    ]
    for (const b of bads) await expect(confirmInvoice(doc, bike, body(b))).rejects.toMatchObject({ statusCode: 400 })
    expect(await db.select().from(expenses)).toHaveLength(0)
    expect(await db.select().from(services).where(eq(services.documentId, doc.id))).toHaveLength(0)
    expect((await reload(doc.id))!.status).toBe('review')
  })
})

describe('discardDocument', () => {
  it('deletes an unconfirmed document and its files', async () => {
    const doc = await makeDoc({ status: 'manual' })
    await discardDocument(doc)
    expect(await reload(doc.id)).toBeUndefined()
    expect(await db.select().from(documentFiles).where(eq(documentFiles.documentId, doc.id))).toHaveLength(0)
  })

  it('a confirmed document cannot be discarded (409), its expenses stay', async () => {
    const doc = await makeDoc()
    await confirmInvoice(doc, bike, body())
    await expect(discardDocument((await reload(doc.id))!)).rejects.toMatchObject({ statusCode: 409 })
    expect(await reload(doc.id)).toBeDefined()
    expect(await db.select().from(expenses)).toHaveLength(3)
  })
})
