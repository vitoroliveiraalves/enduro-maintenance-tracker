import { beforeEach, describe, expect, it, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import { db } from '../../../server/db/client'
import { bikes, documents, expenses, categories, maintenanceItems, user } from '../../../server/db/schema'
import { ownedBike, ownedDocument, ownedExpense, ownedItem } from '../../../server/utils/owned'

// requireUser is covered by the e2e suite; here the "session" is event.context.uid.
vi.mock('../../../server/utils/require-user', () => ({
  requireUser: async (event: { context: { uid?: string } }) => {
    if (!event.context.uid) throw Object.assign(new Error('Unauthorized'), { statusCode: 401 })
    return { id: event.context.uid, email: 'x@example.com' }
  },
}))

const as = (uid?: string) => ({ context: { uid } }) as never

let a: string, b: string, bikeA: string, itemA: string, docA: string, expA: string

beforeEach(async () => {
  await db.execute(sql`TRUNCATE "user" CASCADE`)
  const users = await db
    .insert(user)
    .values([
      { name: 'A', email: 'a@example.com' },
      { name: 'B', email: 'b@example.com' },
    ])
    .returning()
  a = users[0]!.id
  b = users[1]!.id
  const [bike] = await db
    .insert(bikes)
    .values({ userId: a, name: 'KTM', make: 'KTM', model: '300 EXC', year: 2022, stroke: '2T' })
    .returning()
  bikeA = bike!.id
  const [item] = await db
    .insert(maintenanceItems)
    .values({ bikeId: bikeA, userId: a, name: 'Oil', everyHoursTenths: 100 })
    .returning()
  itemA = item!.id
  const [doc] = await db.insert(documents).values({ userId: a }).returning()
  docA = doc!.id
  const [cat] = await db.insert(categories).values({ userId: a, name: 'Other', kind: 'other' }).returning()
  const [exp] = await db
    .insert(expenses)
    .values({ userId: a, at: '2026-01-01', amountCents: 100, categoryId: cat!.id })
    .returning()
  expA = exp!.id
})

describe('owned guards', () => {
  it('returns the bike to its owner', async () => {
    expect((await ownedBike(as(a), bikeA)).id).toBe(bikeA)
  })
  it('404 for another user, unknown id and malformed id', async () => {
    await expect(ownedBike(as(b), bikeA)).rejects.toMatchObject({ statusCode: 404 })
    await expect(ownedBike(as(a), '00000000-0000-4000-8000-000000000000')).rejects.toMatchObject({ statusCode: 404 })
    await expect(ownedBike(as(a), 'nope')).rejects.toMatchObject({ statusCode: 404 })
  })
  it('401 without a session', async () => {
    await expect(ownedBike(as(), bikeA)).rejects.toMatchObject({ statusCode: 401 })
  })
  it('item, document, expense: owner ok, stranger 404', async () => {
    expect((await ownedItem(as(a), itemA)).id).toBe(itemA)
    expect((await ownedDocument(as(a), docA)).id).toBe(docA)
    expect((await ownedExpense(as(a), expA)).id).toBe(expA)
    await expect(ownedItem(as(b), itemA)).rejects.toMatchObject({ statusCode: 404 })
    await expect(ownedDocument(as(b), docA)).rejects.toMatchObject({ statusCode: 404 })
    await expect(ownedExpense(as(b), expA)).rejects.toMatchObject({ statusCode: 404 })
  })
})
