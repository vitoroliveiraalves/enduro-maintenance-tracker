import { beforeEach, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { db } from '../../../server/db/client'
import { meterReadings, user } from '../../../server/db/schema'
import { createBike } from '../../../server/utils/bikes'
import { logReading } from '../../../server/utils/readings'

let uid: string
let bike: Awaited<ReturnType<typeof createBike>>

const bikeBody = () => ({
  clientId: crypto.randomUUID(), name: 'KTM', make: 'KTM', model: '300', year: 2022, stroke: '2T',
  hoursTenths: 1440, km: 3812, items: [{ name: 'Air filter', everyHoursTenths: 50 }],
})
const post = (over: Record<string, unknown> = {}) =>
  logReading(bike, { clientId: crypto.randomUUID(), hoursTenths: 1500, km: 3900, condition: 'normal', ...over })
const count = async () => (await db.select().from(meterReadings)).length

beforeEach(async () => {
  await db.execute(sql`TRUNCATE "user" CASCADE`)
  const [u] = await db.insert(user).values({ name: 'A', email: 'a@example.com' }).returning()
  uid = u!.id
  bike = await createBike(uid, bikeBody())
})

describe('logReading', () => {
  it('saves and returns the bike detail with the new latest reading', async () => {
    const r = await post({ condition: 'mud' })
    expect(r).toMatchObject({ status: 200, body: { latestReading: { hoursTenths: 1500, km: 3900, condition: 'mud' } } })
    expect(await count()).toBe(2)
  })
  it('422 on decrease with the last values, nothing saved', async () => {
    expect(await post({ hoursTenths: 1400 })).toMatchObject({ status: 422, body: { error: 'hours-decreased', last: { hoursTenths: 1440, km: 3812 } } })
    expect(await post({ km: 3000 })).toMatchObject({ status: 422, body: { error: 'km-decreased' } })
    expect(await count()).toBe(1)
  })
  it('409 on big jump unless confirmed', async () => {
    expect(await post({ hoursTenths: 14_400 })).toMatchObject({ status: 409, body: { warn: 'big-jump' } })
    expect(await count()).toBe(1)
    expect(await post({ hoursTenths: 14_400, confirmBigJump: true })).toMatchObject({ status: 200 })
    expect(await count()).toBe(2)
  })
  it('replaying a clientId creates one reading and skips validation', async () => {
    const clientId = crypto.randomUUID()
    await post({ clientId })
    const again = await post({ clientId })
    expect(again.status).toBe(200)
    expect(await count()).toBe(2)
    // after a later reading exists, the replay of the first still succeeds (would be a decrease otherwise)
    await post({ hoursTenths: 1600, km: 4000 })
    expect((await post({ clientId })).status).toBe(200)
    expect(await count()).toBe(3)
  })
  it('backdated entry: compared with neighbours in time', async () => {
    const day = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString()
    await db.update(meterReadings).set({ at: new Date(Date.now() - 10 * 86_400_000) }) // initial reading: 10 days ago
    await post({ hoursTenths: 1600, km: 4000 }) // now
    expect(await post({ at: day(3), hoursTenths: 1550, km: 3950 })).toMatchObject({ status: 200 })
    expect(await post({ at: day(2), hoursTenths: 1650, km: 3950 })).toMatchObject({ status: 422, body: { error: 'hours-exceed-later' } })
    expect(await post({ at: day(2), hoursTenths: 1550, km: 4100 })).toMatchObject({ status: 422, body: { error: 'km-exceed-later' } })
    expect(await post({ at: day(2), hoursTenths: 1500, km: 3950 })).toMatchObject({ status: 422, body: { error: 'hours-decreased' } })
  })
  it('400 for bad input and future dates', async () => {
    for (const over of [{ hoursTenths: -1 }, { hoursTenths: 1.5 }, { km: 'x' }, { condition: 'ice' }, { clientId: 'nope' }, { at: 'garbage' }, { at: new Date(Date.now() + 3 * 86_400_000).toISOString() }]) {
      await expect(post(over)).rejects.toMatchObject({ statusCode: 400 })
    }
  })
})
