import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../../server/db/client'
import { meterReadings, user } from '../../../server/db/schema'
import { createBike } from '../../../server/utils/bikes'
import { logReading, undoLatestReading } from '../../../server/utils/readings'
import { truncateUsers } from '../../support/truncate'

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
  await truncateUsers()
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
  it('a slightly-future `at` (client clock ahead) is stored as now, never in the future', async () => {
    const r = await post({ at: new Date(Date.now() + 3_600_000).toISOString() })
    expect(r.status).toBe(200)
    const rows = await db.select().from(meterReadings)
    expect(Math.max(...rows.map((x) => x.at.getTime()))).toBeLessThanOrEqual(Date.now())
  })
  it('400 for bad input and future dates', async () => {
    for (const over of [{ hoursTenths: -1 }, { hoursTenths: 1.5 }, { km: 'x' }, { condition: 'ice' }, { clientId: 'nope' }, { at: 'garbage' }, { at: new Date(Date.now() + 3 * 86_400_000).toISOString() }]) {
      await expect(post(over)).rejects.toMatchObject({ statusCode: 400 })
    }
  })
})

describe('undoLatestReading (a confirmed typo can be taken back)', () => {
  it('removes the latest reading and returns the detail with the one before', async () => {
    const r = await post({ hoursTenths: 15_000, confirmBigJump: true })
    const id = (r.body as { latestReading: { id: string } }).latestReading.id
    const detail = await undoLatestReading(bike, { readingId: id })
    expect(detail.latestReading).toMatchObject({ hoursTenths: 1440, km: 3812 })
    expect(await count()).toBe(1)
  })
  it('a replay of the same undo changes nothing more', async () => {
    await post()
    const r = await post({ hoursTenths: 1600, km: 4000 })
    const id = (r.body as { latestReading: { id: string } }).latestReading.id
    await undoLatestReading(bike, { readingId: id })
    const again = await undoLatestReading(bike, { readingId: id })
    expect(again.latestReading).toMatchObject({ hoursTenths: 1500 })
    expect(await count()).toBe(2)
  })
  it('only the latest can go; the first reading of a bike stays', async () => {
    const first = (await db.select().from(meterReadings))[0]!
    await expect(undoLatestReading(bike, { readingId: first.id })).rejects.toMatchObject({ statusCode: 409 })
    await post()
    await expect(undoLatestReading(bike, { readingId: first.id })).rejects.toMatchObject({ statusCode: 409 })
    expect(await count()).toBe(2)
  })
  it('a bad id is a 400', async () => {
    await expect(undoLatestReading(bike, { readingId: 'nope' })).rejects.toMatchObject({ statusCode: 400 })
    await expect(undoLatestReading(bike, {})).rejects.toMatchObject({ statusCode: 400 })
  })
})

describe("logReading with the bike's meters", () => {
  const make = (meters: 'km' | 'hours') =>
    createBike(uid, { ...bikeBody(), meters, items: [{ name: 'Chain', [meters === 'km' ? 'everyKm' : 'everyHoursTenths']: 100 }] })

  it('km bike: hours ignored (stored null), condition forced to normal, km required', async () => {
    const kmBike = await make('km')
    const r = await logReading(kmBike, { clientId: crypto.randomUUID(), hoursTenths: 99, km: 4000, condition: 'mud' })
    expect(r).toMatchObject({ status: 200, body: { latestReading: { hoursTenths: null, km: 4000, condition: 'normal' } } })
    await expect(logReading(kmBike, { clientId: crypto.randomUUID(), hoursTenths: 99 })).rejects.toMatchObject({ statusCode: 400 })
  })

  it('km bike: a km decrease is 422 km-decreased', async () => {
    const kmBike = await make('km')
    expect(await logReading(kmBike, { clientId: crypto.randomUUID(), km: 3000 })).toMatchObject({ status: 422, body: { error: 'km-decreased' } })
  })

  it('hours bike: hours required, km ignored (stored null)', async () => {
    const hBike = await make('hours')
    await expect(logReading(hBike, { clientId: crypto.randomUUID(), km: 4000 })).rejects.toMatchObject({ statusCode: 400 })
    const r = await logReading(hBike, { clientId: crypto.randomUUID(), hoursTenths: 1500, km: 4000, condition: 'sand' })
    expect(r).toMatchObject({ status: 200, body: { latestReading: { hoursTenths: 1500, km: null, condition: 'sand' } } })
  })
})
