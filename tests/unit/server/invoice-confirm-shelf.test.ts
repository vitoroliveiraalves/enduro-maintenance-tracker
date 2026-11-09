import { beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { db } from '../../../server/db/client'
import { categories, documentFiles, documents, expenseItems, expenses, partMovements, parts, serviceItems, services, shoppingEntries, user } from '../../../server/db/schema'
import type { Document } from '../../../server/db/schema'
import { DEFAULT_CATEGORIES } from '../../../server/utils/categories-seed'
import { createBike, itemRows } from '../../../server/utils/bikes'
import { confirmInvoice } from '../../../server/utils/invoice-confirm'
import { truncateUsers } from '../../support/truncate'

let uid: string, other: string
let bike: Awaited<ReturnType<typeof createBike>>
let cat: Record<string, string>
let bearings: string, gearbox: string

const day = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString().slice(0, 10)
const uuid = () => crypto.randomUUID()

async function makeDoc(): Promise<Document> {
  const [doc] = await db.insert(documents).values({ userId: uid, status: 'review' }).returning()
  await db.insert(documentFiles).values({ documentId: doc!.id, userId: uid, page: 1, mime: 'image/jpeg', bytes: Buffer.from([0xff, 0xd8, 0xff]), sha256: uuid() })
  return doc!
}
const shelfLine = (shelf: Record<string, unknown>, over: Record<string, unknown> = {}) => ({
  description: 'Rolamentos roda traseira', amountCents: 5640, categoryId: cat.maintenance, itemIds: [bearings], shelf: { clientId: uuid(), ...shelf }, ...over,
})
const usedLine = () => ({ description: 'Óleo', amountCents: 1500, categoryId: cat.maintenance, itemIds: [gearbox] })
const body = (lines: unknown[]) => ({ clientId: uuid(), bikeId: bike.id, at: day(3), hoursTenths: 1400, km: 3790, garageName: 'Garage', lines })
const mk = async (userId: string, name: string, q = 0) =>
  (await db.insert(parts).values({ userId, clientId: uuid(), name, qtyHundredths: q }).returning())[0]!

beforeEach(async () => {
  await truncateUsers()
  const [u, o] = await db.insert(user).values([{ name: 'A', email: 'a@example.com' }, { name: 'B', email: 'b@example.com' }]).returning()
  uid = u!.id
  other = o!.id
  await db.insert(categories).values(DEFAULT_CATEGORIES.map((c) => ({ ...c, userId: uid })))
  cat = Object.fromEntries((await db.select().from(categories).where(eq(categories.userId, uid))).map((c) => [c.kind, c.id]))
  bike = await createBike(uid, {
    clientId: uuid(), name: 'KTM', make: 'KTM', model: '300', year: 2022, stroke: '2T', hoursTenths: 1420, km: 3800,
    items: [{ name: 'Gearbox oil', everyHoursTenths: 150 }, { name: 'Wheel bearings', everyHoursTenths: 500 }],
  })
  const rows = await itemRows(bike.id, uid)
  bearings = rows.find((r) => r.name === 'Wheel bearings')!.id
  gearbox = rows.find((r) => r.name === 'Gearbox oil')!.id
})

describe('confirmInvoice with shelf lines', () => {
  it('a new part: part with the quantity, expense without a service, no service at all', async () => {
    const doc = await makeDoc()
    const s = { partClientId: uuid(), name: 'Rolamentos roda traseira', unit: 'pcs', qtyHundredths: 150 }
    const res = await confirmInvoice(doc, bike, body([shelfLine(s)]))
    expect(res).toMatchObject({ status: 200, body: { serviceId: null } })
    const [p] = await db.select().from(parts)
    expect(p).toMatchObject({ name: 'Rolamentos roda traseira', unit: 'pcs', qtyHundredths: 150, bikeId: bike.id })
    const [e] = await db.select().from(expenses)
    expect(e).toMatchObject({ serviceId: null, amountCents: 5640 })
    expect(await db.select().from(services)).toHaveLength(0)
    expect(await db.select().from(serviceItems)).toHaveLength(0)
    expect(await db.select().from(expenseItems)).toHaveLength(0)
    const [m] = await db.select().from(partMovements)
    expect(m).toMatchObject({ kind: 'bought', partId: p!.id, qtyHundredths: 150, at: day(3), expenseId: e!.id, documentId: doc.id })
  })

  it('bikeId null = any bike', async () => {
    await confirmInvoice(await makeDoc(), bike, body([shelfLine({ partClientId: uuid(), name: 'Grease', qtyHundredths: 100, bikeId: null })]))
    expect((await db.select().from(parts))[0]!.bikeId).toBeNull()
  })

  it('onto an existing part adds to it and ticks its open shopping entry', async () => {
    const part = await mk(uid, 'Bearings', 100)
    const [entry] = await db.insert(shoppingEntries).values({ userId: uid, clientId: uuid(), text: 'Bearings', partId: part.id }).returning()
    await confirmInvoice(await makeDoc(), bike, body([shelfLine({ partId: part.id, qtyHundredths: 200 })]))
    expect((await db.select().from(parts).where(eq(parts.id, part.id)))[0]!.qtyHundredths).toBe(300)
    expect(await db.select().from(parts)).toHaveLength(1)
    expect((await db.select().from(shoppingEntries).where(eq(shoppingEntries.id, entry!.id)))[0]!.doneAt).not.toBeNull()
  })

  it('mixed invoice: the service links only the used line’s items', async () => {
    const doc = await makeDoc()
    const res = await confirmInvoice(doc, bike, body([usedLine(), shelfLine({ partClientId: uuid(), name: 'Rolamentos', qtyHundredths: 100 })]))
    expect(res.status).toBe(200)
    const [svc] = await db.select().from(services)
    expect((await db.select().from(serviceItems).where(eq(serviceItems.serviceId, svc!.id))).map((l) => l.itemId)).toEqual([gearbox])
    const exps = await db.select().from(expenses)
    expect(exps.map((e) => e.serviceId).sort()).toEqual([svc!.id, null].sort())
  })

  it('bad shelf lines → 400 and nothing is written', async () => {
    const mine = await mk(uid, 'Mine')
    const theirs = await mk(other, 'Theirs')
    const ok = { partClientId: uuid(), name: 'X', qtyHundredths: 100 }
    for (const s of [
      { ...ok, qtyHundredths: 0 }, { ...ok, qtyHundredths: -5 }, { ...ok, qtyHundredths: 1.5 }, { ...ok, qtyHundredths: '1' },
      { partId: theirs.id, qtyHundredths: 100 }, { partId: 'nope', qtyHundredths: 100 }, { partId: uuid(), qtyHundredths: 100 },
      { qtyHundredths: 100 }, { ...ok, name: '  ' }, { ...ok, partClientId: 'nope' }, { name: 'X', qtyHundredths: 100 }, { ...ok, bikeId: 'nope' },
      { ...ok, clientId: 'nope' },
    ]) {
      await expect(confirmInvoice(await makeDoc(), bike, body([shelfLine(s, { itemIds: [] }), usedLine()])), JSON.stringify(s)).rejects.toMatchObject({ statusCode: 400 })
    }
    await expect(confirmInvoice(await makeDoc(), bike, body([shelfLine({ partId: mine.id, qtyHundredths: 1 }), 'x']))).rejects.toMatchObject({ statusCode: 400 })
    const dup = uuid()
    await expect(
      confirmInvoice(await makeDoc(), bike, body([shelfLine({ ...ok, clientId: dup }), shelfLine({ partClientId: uuid(), name: 'Y', qtyHundredths: 1, clientId: dup })])),
    ).rejects.toMatchObject({ statusCode: 400 })
    expect(await db.select().from(expenses)).toHaveLength(0)
    expect(await db.select().from(partMovements)).toHaveLength(0)
    expect(await db.select().from(services)).toHaveLength(0)
    expect(await db.select().from(parts)).toHaveLength(2)
  })
})
