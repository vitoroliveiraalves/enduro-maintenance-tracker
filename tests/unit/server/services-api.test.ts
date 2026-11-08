import { beforeEach, describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { db } from '../../../server/db/client'
import { categories, documents, expenseItems, expenses, serviceItems, services, user } from '../../../server/db/schema'
import { DEFAULT_CATEGORIES } from '../../../server/utils/categories-seed'
import { createBike, itemRows } from '../../../server/utils/bikes'
import { createCategory, deleteCategory, listCategories, renameCategory } from '../../../server/utils/categories'
import { createExpense, listExpenses, patchExpense } from '../../../server/utils/expenses'
import { createService, deleteService, listServices } from '../../../server/utils/services'

let uid: string, other: string
let bike: Awaited<ReturnType<typeof createBike>>
let cat: string

const day = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString().slice(0, 10)
const bikeBody = () => ({
  clientId: crypto.randomUUID(), name: 'KTM', make: 'KTM', model: '300', year: 2022, stroke: '2T',
  hoursTenths: 1420, km: 3800,
  items: [
    { name: 'Gearbox oil', everyHoursTenths: 150, lastDone: { at: day(100), hoursTenths: 1000, km: 3000 } },
    { name: 'Oil filter', everyHoursTenths: 150, lastDone: { at: day(100), hoursTenths: 1000, km: 3000 } },
    { name: 'Air filter', everyHoursTenths: 50 },
  ],
})
const items = async () => Object.fromEntries((await itemRows(bike.id, uid)).map((r) => [r.name, r]))
const svc = async (over: Record<string, unknown> = {}) => {
  const it = await items()
  return createService(bike, { clientId: crypto.randomUUID(), at: day(0), hoursTenths: 1420, km: 3800, by: 'diy', itemIds: [it['Gearbox oil']!.id, it['Oil filter']!.id], ...over })
}
const exp = (over: Record<string, unknown> = {}) =>
  createExpense(uid, bike, { clientId: crypto.randomUUID(), at: day(0), amountCents: 2490, categoryId: cat, description: 'x', ...over })

beforeEach(async () => {
  await db.execute(sql`TRUNCATE "user" CASCADE`)
  const [u, o] = await db.insert(user).values([{ name: 'A', email: 'a@example.com' }, { name: 'B', email: 'b@example.com' }]).returning()
  uid = u!.id
  other = o!.id
  await db.insert(categories).values(DEFAULT_CATEGORIES.map((c) => ({ ...c, userId: uid })))
  cat = (await listCategories(uid))[0]!.id
  bike = await createBike(uid, bikeBody())
})

describe('createService', () => {
  it('resets every picked item and books a linked cost', async () => {
    const before = await items()
    expect(before['Gearbox oil']!.status.state).toBe('overdue')
    const it = before
    await svc({ expenses: [{ amountCents: 2490, categoryId: cat, description: 'Oil' }] })
    const after = await items()
    expect(after['Gearbox oil']!.status.state).toBe('ok')
    expect(after['Oil filter']!.status.state).toBe('ok')
    expect(after['Air filter']!.status.state).toBe('unknown')
    const [e] = await db.select().from(expenses)
    expect(e).toMatchObject({ amountCents: 2490, bikeId: bike.id, at: day(0) })
    expect(e!.serviceId).not.toBeNull()
    const links = await db.select().from(expenseItems).where(eq(expenseItems.expenseId, e!.id))
    expect(links.map((l) => l.itemId).sort()).toEqual([it['Gearbox oil']!.id, it['Oil filter']!.id].sort())
  })

  it('a backdated service does not change the status (still counts from the highest hours)', async () => {
    await svc({ at: day(5), hoursTenths: 1380 })
    // newer service at 1420 first, then a late entry for 1380 "last Sunday"
    const it = await items()
    await createService(bike, { clientId: crypto.randomUUID(), at: day(0), hoursTenths: 1400, km: 3790, by: 'diy', itemIds: [it['Gearbox oil']!.id] })
    const mid = (await items())['Gearbox oil']!
    await createService(bike, { clientId: crypto.randomUUID(), at: day(8), hoursTenths: 1300, km: 3700, by: 'diy', itemIds: [it['Gearbox oil']!.id] })
    const end = (await items())['Gearbox oil']!
    expect(mid.last?.hoursTenths).toBe(1400)
    expect(end.last?.hoursTenths).toBe(1400)
    expect({ ...end.status, sinceMonths: 0 }).toEqual({ ...mid.status, sinceMonths: 0 })
  })

  it('replaying a clientId creates nothing new', async () => {
    const clientId = crypto.randomUUID()
    const body = { clientId, expenses: [{ amountCents: 100, categoryId: cat, description: '' }] }
    await svc(body)
    await svc(body)
    expect(await db.select().from(services).then((r) => r.filter((s) => s.clientId === clientId))).toHaveLength(1)
    expect(await db.select().from(expenses)).toHaveLength(1)
  })

  it('keeps garage name only for garage services', async () => {
    await svc({ by: 'garage', garageName: 'Moto Pro' })
    await svc({ by: 'diy', garageName: 'Ignored' })
    const rows = await db.select().from(services)
    expect(rows.find((r) => r.garageName === 'Moto Pro')?.by).toBe('garage')
    expect(rows.filter((r) => r.garageName === 'Ignored')).toHaveLength(0)
    await svc({ by: 'garage' })
  })

  it('400s on bad input and writes nothing', async () => {
    const it = await items()
    const [foreign] = [await createBike(other, { ...bikeBody(), clientId: crypto.randomUUID() })]
    const foreignItem = (await itemRows(foreign.id, other))[0]!.id
    const [otherCat] = await db.insert(categories).values({ userId: other, name: 'Z', kind: 'other' }).returning()
    const [foreignDoc] = await db.insert(documents).values({ userId: other }).returning()
    const cases: Record<string, unknown>[] = [
      { hoursTenths: 1421 },
      { km: 3801 },
      { at: day(-3) },
      { at: '2026-02-31' },
      { at: 'garbage' },
      { by: 'robot' },
      { itemIds: [] },
      { itemIds: ['nope'] },
      { itemIds: [foreignItem] },
      { itemIds: [it['Gearbox oil']!.id, foreignItem] },
      { clientId: 'x' },
      { expenses: [{ amountCents: 0, categoryId: cat }] },
      { expenses: [{ amountCents: 10_000_001, categoryId: cat }] },
      { expenses: [{ amountCents: 1.5, categoryId: cat }] },
      { expenses: [{ amountCents: 100, categoryId: otherCat!.id }] },
      { documentId: foreignDoc!.id },
    ]
    for (const c of cases) await expect(svc(c), JSON.stringify(c)).rejects.toMatchObject({ statusCode: 400 })
    expect(await db.select().from(services)).toHaveLength(4) // only the Initial ones (2 mine, 2 foreign)
    expect(await db.select().from(expenses)).toHaveLength(0)
  })

  it('accepts a date one day ahead (timezone slack)', async () => {
    await expect(svc({ at: day(-1) })).resolves.toBeTruthy()
  })
})

describe('deleteService', () => {
  it('restores the previous last-done and removes its items and own costs', async () => {
    const it = await items()
    const first = await svc({ at: day(10), hoursTenths: 1300, km: 3500, itemIds: [it['Gearbox oil']!.id] })
    expect(first.items.find((i) => i.name === 'Gearbox oil')!.last?.hoursTenths).toBe(1300)
    await svc({ expenses: [{ amountCents: 500, categoryId: cat, description: '' }], itemIds: [it['Gearbox oil']!.id] })
    expect((await items())['Gearbox oil']!.last?.hoursTenths).toBe(1420)
    const latest = (await listServices(uid)).find((s) => s.hoursTenths === 1420)!
    const detail = await deleteService((await db.select().from(services).where(eq(services.id, latest.id)))[0]!)
    expect(detail.items.find((i) => i.name === 'Gearbox oil')!.last?.hoursTenths).toBe(1300)
    expect(await db.select().from(serviceItems).where(eq(serviceItems.serviceId, latest.id))).toHaveLength(0)
    expect(await db.select().from(expenses)).toHaveLength(0)
  })

  it('keeps invoice-backed expenses, unlinked', async () => {
    const [doc] = await db.insert(documents).values({ userId: uid }).returning()
    await svc({ documentId: doc!.id, expenses: [{ amountCents: 900, categoryId: cat, description: 'inv' }] })
    const [s] = await db.select().from(services).where(eq(services.documentId, doc!.id))
    await db.update(expenses).set({ documentId: doc!.id })
    await svc({ expenses: [{ amountCents: 100, categoryId: cat, description: 'own' }] })
    await deleteService(s!)
    const left = await db.select().from(expenses)
    expect(left.map((e) => e.description).sort()).toEqual(['inv', 'own'])
    expect(left.find((e) => e.description === 'inv')).toMatchObject({ serviceId: null, documentId: doc!.id })
    expect(await db.select().from(services).where(eq(services.id, s!.id))).toHaveLength(0)
  })
})

describe('listServices', () => {
  it('has item names, bike name and total cost', async () => {
    await svc({ by: 'garage', garageName: 'G', expenses: [{ amountCents: 1000, categoryId: cat, description: '' }, { amountCents: 250, categoryId: cat, description: '' }] })
    const [s] = (await listServices(uid)).filter((x) => x.totalCents)
    expect(s).toMatchObject({ bikeName: 'KTM', by: 'garage', totalCents: 1250 })
    expect(s!.itemNames.sort()).toEqual(['Gearbox oil', 'Oil filter'])
    expect(await listServices(other)).toHaveLength(0)
  })
})

describe('expenses', () => {
  it('creates a standalone expense with no bike, idempotent on clientId', async () => {
    const clientId = crypto.randomUUID()
    const a = await createExpense(uid, null, { clientId, at: day(0), amountCents: 4160, categoryId: cat, description: 'Fuel' })
    const b = await createExpense(uid, null, { clientId, at: day(0), amountCents: 4160, categoryId: cat, description: 'Fuel' })
    expect(b.id).toBe(a.id)
    expect(a).toMatchObject({ bikeId: null, serviceId: null, documentId: null, categoryName: expect.any(String) })
    expect(await db.select().from(expenses)).toHaveLength(1)
  })
  it('links items of the bike', async () => {
    const it = await items()
    const e = await exp({ itemIds: [it['Air filter']!.id] })
    expect(e.itemIds).toEqual([it['Air filter']!.id])
  })
  it('400s: amount range, foreign category, item without bike, foreign item', async () => {
    const it = await items()
    const [otherCat] = await db.insert(categories).values({ userId: other, name: 'Z', kind: 'other' }).returning()
    for (const c of [{ amountCents: 0 }, { amountCents: 10_000_001 }, { amountCents: 2.5 }, { amountCents: '24,90' }, { categoryId: otherCat!.id }, { at: day(-3) }, { description: 'x'.repeat(201) }]) {
      await expect(exp(c), JSON.stringify(c)).rejects.toMatchObject({ statusCode: 400 })
    }
    await expect(createExpense(uid, null, { clientId: crypto.randomUUID(), at: day(0), amountCents: 1, categoryId: cat, itemIds: [it['Air filter']!.id] })).rejects.toMatchObject({ statusCode: 400 })
    const foreign = await createBike(other, bikeBody())
    const fi = (await itemRows(foreign.id, other))[0]!.id
    await expect(exp({ itemIds: [fi] })).rejects.toMatchObject({ statusCode: 400 })
    expect(await db.select().from(expenses)).toHaveLength(0)
    expect(10_000_000).toBe(Math.round(100_000 * 100))
    expect(2490).toBe(Math.round(24.9 * 100))
  })
  it('lists with filters and patches', async () => {
    await exp({ at: '2026-01-10' })
    const b = await exp({ at: '2026-03-10', amountCents: 100 })
    expect((await listExpenses(uid, { from: '2026-02-01' })).map((e) => e.id)).toEqual([b.id])
    expect(await listExpenses(other)).toHaveLength(0)
    const p = await patchExpense(uid, (await db.select().from(expenses).where(eq(expenses.id, b.id)))[0]!, { amountCents: 777, description: 'new' })
    expect(p).toMatchObject({ amountCents: 777, description: 'new' })
  })
})

describe('categories', () => {
  it('creates, renames, scopes, and refuses to delete a used category', async () => {
    const c = await createCategory(uid, { clientId: crypto.randomUUID(), name: 'Tools', kind: 'gear' })
    await expect(createCategory(uid, { clientId: crypto.randomUUID(), name: 'T', kind: 'nope' })).rejects.toMatchObject({ statusCode: 400 })
    expect((await renameCategory(uid, c, { name: 'Workshop' })).name).toBe('Workshop')
    expect((await listCategories(other))).toHaveLength(0)
    await exp({ categoryId: c.id })
    await expect(deleteCategory(uid, c)).rejects.toMatchObject({ statusCode: 409 })
    const free = await createCategory(uid, { clientId: crypto.randomUUID(), name: 'Free', kind: 'other' })
    await deleteCategory(uid, free)
    expect((await listCategories(uid)).find((x) => x.id === free.id)).toBeUndefined()
  })
})
