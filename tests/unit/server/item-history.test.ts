import { beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { db } from '../../../server/db/client'
import { expenses, services as servicesTable, user } from '../../../server/db/schema'
import { createBike, itemRows } from '../../../server/utils/bikes'
import { createService } from '../../../server/utils/services'
import { itemHistory } from '../../../server/utils/item-history'
import { createCategory } from '../../../server/utils/categories'
import { truncateUsers } from '../../support/truncate'

let uid: string, other: string
const day = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString().slice(0, 10)

beforeEach(async () => {
  await truncateUsers()
  const [u, o] = await db.insert(user).values([{ name: 'A', email: 'a@example.com' }, { name: 'B', email: 'b@example.com' }]).returning()
  uid = u!.id
  other = o!.id
})

describe('itemHistory', () => {
  it('lists services newest-by-hours first with summed costs, only this user and this service', async () => {
    const bike = await createBike(uid, {
      clientId: crypto.randomUUID(), name: 'KTM', make: 'KTM', model: '300', year: 2022, stroke: '2T', hoursTenths: 1420, km: 3800,
      items: [{ name: 'Oil', everyHoursTenths: 200, lastDone: { at: day(50), hoursTenths: 1000, km: 3000 } }],
    })
    const item = (await itemRows(bike.id, uid))[0]!
    const cat = await createCategory(uid, { clientId: crypto.randomUUID(), name: 'Parts', kind: 'parts' })
    const otherCat = await createCategory(other, { clientId: crypto.randomUUID(), name: 'Parts', kind: 'parts' })
    await createService(bike, {
      clientId: crypto.randomUUID(), at: day(20), hoursTenths: 1300, km: 3500, by: 'garage', garageName: 'Moto Braga', itemIds: [item.id],
      expenses: [{ amountCents: 5000, categoryId: cat.id, description: 'a' }, { amountCents: 1250, categoryId: cat.id, description: 'b' }],
    })
    await createService(bike, {
      clientId: crypto.randomUUID(), at: day(1), hoursTenths: 1250, by: 'diy', itemIds: [item.id],
      expenses: [{ amountCents: 777, categoryId: cat.id, description: 'other service' }],
    })
    const [garageSvc] = await db.select().from(servicesTable).where(eq(servicesTable.hoursTenths, 1300))
    // An expense owned by another user that points at the same service must not be counted.
    await db.insert(expenses).values({ userId: other, clientId: crypto.randomUUID(), at: day(1), amountCents: 99_999, categoryId: otherCat.id, serviceId: garageSvc!.id })

    const h = await itemHistory(item.id, uid)
    expect(h.item.name).toBe('Oil')
    expect(h.item.bikeId).toBe(bike.id)
    expect(h.status).toEqual(h.item.status)
    expect(h.services.map((s) => s.hoursTenths)).toEqual([1300, 1250, 1000])
    expect(h.services[0]).toMatchObject({ by: 'garage', garageName: 'Moto Braga', costCents: 6250 })
    expect(h.services[1]!.costCents).toBe(777)
    expect(h.services[2]!.costCents).toBe(0)
  })
  it('404 for another user', async () => {
    const bike = await createBike(uid, {
      clientId: crypto.randomUUID(), name: 'K', make: 'K', model: 'x', year: 2022, stroke: '2T', hoursTenths: 10, km: 1,
      items: [{ name: 'Oil', everyHoursTenths: 200 }],
    })
    const item = (await itemRows(bike.id, uid))[0]!
    await expect(itemHistory(item.id, crypto.randomUUID())).rejects.toMatchObject({ statusCode: 404 })
  })
})
