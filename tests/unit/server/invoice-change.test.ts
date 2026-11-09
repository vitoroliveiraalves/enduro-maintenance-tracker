import { beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { db } from '../../../server/db/client'
import { categories, documentFiles, documents, expenseItems, expenses, partMovements, parts, serviceItems, services, user } from '../../../server/db/schema'
import type { Bike, Document } from '../../../server/db/schema'
import { DEFAULT_CATEGORIES } from '../../../server/utils/categories-seed'
import { createBike, itemRows } from '../../../server/utils/bikes'
import { confirmInvoice, deleteDocument, savedForm, stockWarnings } from '../../../server/utils/invoice-confirm'
import { listDocuments } from '../../../server/utils/invoice-list'
import { applyMovement } from '../../../server/utils/parts'
import { truncateUsers } from '../../support/truncate'

let uid: string, other: string
let ktm: Bike, cb: Bike
let cat: Record<string, string>
let gearbox: string, chain: string

const day = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString().slice(0, 10)
const uuid = () => crypto.randomUUID()
const fresh = async (id: string) => (await db.select().from(documents).where(eq(documents.id, id)))[0]!

async function makeDoc(userId = uid, totalCents: number | null = null): Promise<Document> {
  const [doc] = await db.insert(documents).values({ userId, status: 'review', totalCents }).returning()
  await db.insert(documentFiles).values({ documentId: doc!.id, userId, page: 1, mime: 'image/jpeg', bytes: Buffer.from([0xff, 0xd8, 0xff]), sha256: uuid() })
  return doc!
}
const oilLine = (amountCents = 1500, itemIds = [gearbox]) => ({ description: 'Óleo', amountCents, categoryId: cat.maintenance, itemIds })
const shelfNew = (name = 'Junta', q = 200) => ({ description: name, amountCents: 800, categoryId: cat.parts, shelf: { clientId: uuid(), partClientId: uuid(), name, qtyHundredths: q } })
const body = (bikeId: string, lines: unknown[], over: Record<string, unknown> = {}) => ({ clientId: uuid(), bikeId, at: day(3), garageName: 'Moto Braga', lines, ...over })

beforeEach(async () => {
  await truncateUsers()
  const [u, o] = await db.insert(user).values([{ name: 'A', email: 'a@example.com' }, { name: 'B', email: 'b@example.com' }]).returning()
  uid = u!.id
  other = o!.id
  await db.insert(categories).values(DEFAULT_CATEGORIES.map((c) => ({ ...c, userId: uid })))
  cat = Object.fromEntries((await db.select().from(categories).where(eq(categories.userId, uid))).map((c) => [c.kind, c.id]))
  ktm = await createBike(uid, { clientId: uuid(), name: 'KTM', make: 'KTM', model: '300', year: 2022, stroke: '2T', hoursTenths: 1420, km: 3800, items: [{ name: 'Gearbox oil', everyHoursTenths: 150 }] })
  cb = await createBike(uid, { clientId: uuid(), name: 'CB', make: 'Honda', model: 'CB500F', year: 2020, stroke: '4T', meters: 'km', km: 12000, items: [{ name: 'Chain', everyKm: 1000 }] })
  gearbox = (await itemRows(ktm.id, uid))[0]!.id
  chain = (await itemRows(cb.id, uid))[0]!.id
})

describe('changing a saved invoice', () => {
  it('replace moves the invoice to another bike with the corrected lines', async () => {
    const doc = await makeDoc()
    await confirmInvoice(doc, ktm, body(ktm.id, [oilLine(), shelfNew()], { hoursTenths: 1400 }))
    const [part] = await db.select().from(parts)
    const form = (await savedForm(await fresh(doc.id)))!
    expect(form).toMatchObject({ bikeId: ktm.id, at: day(3), hoursTenths: 1400, garageName: 'Moto Braga' })
    expect(form.lines).toEqual([
      { description: 'Óleo', amountCents: 1500, categoryId: cat.maintenance, itemIds: [gearbox], shelf: null },
      { description: 'Junta', amountCents: 800, categoryId: cat.parts, itemIds: [], shelf: { partId: part!.id, name: 'Junta', unit: 'pcs', qtyHundredths: 200 } },
    ])

    const res = await confirmInvoice(await fresh(doc.id), cb, body(cb.id, [
      oilLine(1700, [chain]),
      { description: 'Junta', amountCents: 800, categoryId: cat.parts, shelf: { clientId: uuid(), partId: part!.id, qtyHundredths: 300 } },
    ], { km: 11900, replace: true }))
    expect(res.status).toBe(200)
    const exp = await db.select().from(expenses)
    expect(exp.map((e) => [e.bikeId, e.amountCents]).sort()).toEqual([[cb.id, 1700], [cb.id, 800]].sort())
    const svc = await db.select().from(services)
    expect(svc).toHaveLength(1)
    expect(svc[0]).toMatchObject({ bikeId: cb.id, km: 11900, documentId: doc.id })
    expect((await db.select().from(serviceItems)).map((s) => s.itemId)).toEqual([chain])
    expect((await db.select().from(expenseItems)).map((s) => s.itemId)).toEqual([chain])
    expect(await db.select().from(partMovements)).toHaveLength(1)
    expect((await db.select().from(parts))[0]!.qtyHundredths).toBe(300)
  })

  it('a replace that fails totals or validation leaves the saved invoice exactly as it was', async () => {
    const doc = await makeDoc(uid, 2300)
    await confirmInvoice(doc, ktm, body(ktm.id, [oilLine(), shelfNew()]))
    const before = { e: await db.select().from(expenses), s: await db.select().from(services), m: await db.select().from(partMovements), p: await db.select().from(parts) }
    const mismatch = await confirmInvoice(await fresh(doc.id), ktm, body(ktm.id, [oilLine(9900)], { replace: true }))
    expect(mismatch.status).toBe(409)
    await expect(confirmInvoice(await fresh(doc.id), ktm, body(ktm.id, [{ ...oilLine(), categoryId: uuid() }], { replace: true }))).rejects.toMatchObject({ statusCode: 400 })
    expect(await db.select().from(expenses)).toEqual(before.e)
    expect(await db.select().from(services)).toEqual(before.s)
    expect(await db.select().from(partMovements)).toEqual(before.m)
    expect(await db.select().from(parts)).toEqual(before.p)
  })

  it('without replace a saved invoice is still 409; replace on an unsaved one is a normal save', async () => {
    const doc = await makeDoc()
    const res = await confirmInvoice(doc, ktm, body(ktm.id, [oilLine()], { replace: true }))
    expect(res.status).toBe(200)
    await expect(confirmInvoice(await fresh(doc.id), ktm, body(ktm.id, [oilLine()]))).rejects.toMatchObject({ statusCode: 409 })
    await expect(confirmInvoice(await fresh(doc.id), ktm, body(ktm.id, [oilLine()], { replace: 'yes' }))).rejects.toMatchObject({ statusCode: 409 })
  })

  it('undo leaves another invoice on the same part alone', async () => {
    const a = await makeDoc()
    await confirmInvoice(a, ktm, body(ktm.id, [shelfNew('Junta', 200)]))
    const [part] = await db.select().from(parts)
    const b = await makeDoc()
    await confirmInvoice(b, ktm, body(ktm.id, [{ description: 'Junta', amountCents: 800, categoryId: cat.parts, shelf: { clientId: uuid(), partId: part!.id, qtyHundredths: 100 } }]))
    await deleteDocument(await fresh(a.id))
    expect((await db.select().from(parts))[0]!.qtyHundredths).toBe(100)
    expect((await db.select().from(partMovements)).map((m) => m.documentId)).toEqual([b.id])
    expect((await db.select().from(expenses)).map((e) => e.documentId)).toEqual([b.id])
  })
})

describe('deleting an invoice', () => {
  it('removes its costs, service, movements, files and the document; a part only it made goes', async () => {
    const doc = await makeDoc()
    await confirmInvoice(doc, ktm, body(ktm.id, [oilLine(), shelfNew()]))
    await deleteDocument(await fresh(doc.id))
    expect(await db.select().from(documents)).toHaveLength(0)
    expect(await db.select().from(documentFiles)).toHaveLength(0)
    expect(await db.select().from(expenses)).toHaveLength(0)
    expect(await db.select().from(services)).toHaveLength(0)
    expect(await db.select().from(partMovements)).toHaveLength(0)
    expect(await db.select().from(parts)).toHaveLength(0)
  })

  it('a part used since stays, lowered (it may go below zero), and the warning says so first', async () => {
    const doc = await makeDoc()
    await confirmInvoice(doc, ktm, body(ktm.id, [shelfNew('Junta', 200)]))
    const [part] = await db.select().from(parts)
    await applyMovement(db, { userId: uid, clientId: uuid(), part: part!, partName: 'Junta', unit: 'pcs', kind: 'adjust', qtyHundredths: -300, at: day(1) })
    expect(await stockWarnings(await fresh(doc.id))).toEqual([{ name: 'Junta', unit: 'pcs', afterHundredths: -300 }])
    await deleteDocument(await fresh(doc.id))
    const [left] = await db.select().from(parts)
    expect(left!.qtyHundredths).toBe(-300)
  })

  it('an unsaved document is deleted as before', async () => {
    const doc = await makeDoc()
    await deleteDocument(doc)
    expect(await db.select().from(documents)).toHaveLength(0)
  })
})

describe('listDocuments', () => {
  it('unsaved first, then newest; total from its costs; only the rider’s own', async () => {
    const old = await makeDoc()
    await confirmInvoice(old, ktm, body(ktm.id, [oilLine(1500)], { at: day(30) }))
    const recent = await makeDoc()
    await confirmInvoice(recent, cb, body(cb.id, [oilLine(1000, [chain]), shelfNew()], { at: day(2) }))
    const pending = await makeDoc()
    await makeDoc(other)
    const list = await listDocuments(uid)
    expect(list.map((d) => d.id)).toEqual([pending.id, recent.id, old.id])
    expect(list[1]).toMatchObject({ status: 'confirmed', bikeId: cb.id, bikeName: 'CB', totalCents: 1800, lines: 2, supplierName: 'Moto Braga', issuedAt: day(2) })
    expect(list[0]).toMatchObject({ status: 'review', bikeId: null, lines: 0 })
    expect(await listDocuments(other)).toHaveLength(1)
  })
})
