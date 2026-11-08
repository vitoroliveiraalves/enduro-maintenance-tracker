import { beforeEach, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { db } from '../../../server/db/client'
import { user } from '../../../server/db/schema'
import { DEFAULT_CATEGORIES } from '../../../server/utils/categories-seed'
import { createBike, itemRows } from '../../../server/utils/bikes'
import { createService } from '../../../server/utils/services'
import { itemHistory } from '../../../server/utils/item-history'
import { listCategories } from '../../../server/utils/categories'

let uid: string
const day = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString().slice(0, 10)

beforeEach(async () => {
  await db.execute(sql`TRUNCATE "user" CASCADE`)
  const [u] = await db.insert(user).values({ name: 'A', email: 'a@example.com' }).returning()
  uid = u!.id
})

describe('itemHistory', () => {
  it('lists services newest-by-hours first with summed costs', async () => {
    void DEFAULT_CATEGORIES
    const bike = await createBike(uid, {
      clientId: crypto.randomUUID(), name: 'KTM', make: 'KTM', model: '300', year: 2022, stroke: '2T', hoursTenths: 1420, km: 3800,
      items: [{ name: 'Oil', everyHoursTenths: 200, lastDone: { at: day(50), hoursTenths: 1000, km: 3000 } }],
    })
    const item = (await itemRows(bike.id, uid))[0]!
    const cat = (await listCategories(uid))[0]?.id
    // backdated service has fewer hours than the Initial one? no: higher hours, older date wins on hours
    await createService(bike, { clientId: crypto.randomUUID(), at: day(20), hoursTenths: 1300, km: 3500, by: 'garage', garageName: 'Moto Braga', itemIds: [item.id], ...(cat ? { expenses: [{ amountCents: 5000, categoryId: cat, description: 'a' }, { amountCents: 1250, categoryId: cat, description: 'b' }] } : {}) })
    await createService(bike, { clientId: crypto.randomUUID(), at: day(1), hoursTenths: 1250, by: 'diy', itemIds: [item.id] })
    const h = await itemHistory(item.id, uid)
    expect(h.item.name).toBe('Oil')
    expect(h.item.bikeId).toBe(bike.id)
    expect(h.status).toEqual(h.item.status)
    expect(h.services.map((s) => s.hoursTenths)).toEqual([1300, 1250, 1000])
    expect(h.services[0]).toMatchObject({ by: 'garage', garageName: 'Moto Braga', costCents: cat ? 6250 : 0 })
    expect(h.services[1]!.costCents).toBe(0)
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
