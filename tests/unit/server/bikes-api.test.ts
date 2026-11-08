import { beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { db } from '../../../server/db/client'
import { bikes, maintenanceItems, meterReadings, services, user } from '../../../server/db/schema'
import { TEMPLATES } from '../../../server/domain/templates'
import { bikeDetail, createBike, createItem, itemRows, listBikes, patchItem } from '../../../server/utils/bikes'
import { truncateUsers } from '../../support/truncate'

let uid: string, other: string

const body = (over: Record<string, unknown> = {}) => ({
  clientId: crypto.randomUUID(),
  name: 'KTM 300 EXC',
  make: 'KTM',
  model: '300 EXC',
  year: 2022,
  stroke: '2T',
  hoursTenths: 1425,
  km: 3812,
  items: structuredClone(TEMPLATES['2T']).map((i) =>
    i.name === 'Gearbox oil' ? { ...i, lastDone: { at: '2026-09-01', hoursTenths: 1220 } } : i,
  ),
  ...over,
})

beforeEach(async () => {
  await truncateUsers()
  const rows = await db
    .insert(user)
    .values([
      { name: 'A', email: 'a@example.com' },
      { name: 'B', email: 'b@example.com' },
    ])
    .returning()
  uid = rows[0]!.id
  other = rows[1]!.id
})

describe('bikes api logic', () => {
  it('creates bike, reading, items and Initial services; overdue first, unknown last', async () => {
    const bike = await createBike(uid, body())
    const detail = await bikeDetail(bike)
    expect(detail.latestReading).toMatchObject({ hoursTenths: 1425, km: 3812 })
    expect(detail.items).toHaveLength(TEMPLATES['2T'].length)
    const first = detail.items[0]!
    expect(first.name).toBe('Gearbox oil')
    expect(first.status.state).toBe('overdue')
    expect(first.last).toMatchObject({ hoursTenths: 1220, by: 'diy' })
    const rest = detail.items.slice(1)
    expect(rest.every((r) => r.status.state === 'unknown' && r.last === null)).toBe(true)
    const svc = await db.select().from(services).where(eq(services.bikeId, bike.id))
    expect(svc).toHaveLength(1)
    expect(svc[0]).toMatchObject({ by: 'diy', notes: 'Initial', hoursTenths: 1220 })
  })

  it('replaying the same clientId returns the existing bike and creates nothing', async () => {
    const b = body()
    const one = await createBike(uid, b)
    const two = await createBike(uid, b)
    expect(two.id).toBe(one.id)
    expect(await db.select().from(bikes)).toHaveLength(1)
    expect(await db.select().from(meterReadings)).toHaveLength(1)
    expect(await db.select().from(maintenanceItems)).toHaveLength(TEMPLATES['2T'].length)
    expect(await db.select().from(services)).toHaveLength(1)
  })

  it('rolls back everything when an item is invalid', async () => {
    await expect(createBike(uid, body({ items: [{ name: 'x' }] }))).rejects.toMatchObject({ statusCode: 400 })
    expect(await db.select().from(bikes)).toHaveLength(0)
  })

  it('lists bikes with counts, scoped to the user', async () => {
    await createBike(uid, body())
    await createBike(other, body())
    const list = await listBikes(uid)
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ name: 'KTM 300 EXC', year: 2022, counts: { overdue: 1, soon: 0 } })
    expect(list[0]!.latestReading).toMatchObject({ hoursTenths: 1425, km: 3812 })
  })

  it('a bike with no items has no latest reading problems and templates are not mutated', async () => {
    const before = JSON.stringify(TEMPLATES)
    const bike = await createBike(uid, body({ items: [] }))
    expect((await bikeDetail(bike)).items).toEqual([])
    expect(JSON.stringify(TEMPLATES)).toBe(before)
  })

  it('items: idempotent create, patch intervals, archive hides', async () => {
    const bike = await createBike(uid, body({ items: [] }))
    const input = { clientId: crypto.randomUUID(), name: 'Clutch', everyHoursTenths: 400, conditionMultipliers: {} }
    const a = await createItem(bike, input)
    const b = await createItem(bike, input)
    expect(b.id).toBe(a.id)
    const patched = await patchItem(a, uid, { everyHoursTenths: 300, everyKm: 1000 })
    expect(patched).toMatchObject({ everyHoursTenths: 300, everyKm: 1000 })
    await expect(patchItem(a, uid, { everyHoursTenths: null, everyKm: null })).rejects.toMatchObject({ statusCode: 400 })
    await patchItem(a, uid, { archived: true })
    expect(await itemRows(bike.id, uid)).toEqual([])
  })

  describe('lastDone validation', () => {
    const withLast = (lastDone: Record<string, unknown>) =>
      body({ items: [{ name: 'Oil', everyHoursTenths: 150, conditionMultipliers: {}, lastDone }] })
    const reject = async (lastDone: Record<string, unknown>, msg: RegExp) => {
      await expect(createBike(uid, withLast(lastDone))).rejects.toMatchObject({ statusCode: 400, statusMessage: expect.stringMatching(msg) })
      expect(await db.select().from(bikes)).toHaveLength(0)
    }
    it('rejects hours above current', () => reject({ at: '2026-09-01', hoursTenths: 2000 }, /200\.0 h is more than the bike's current 142\.5 h/))
    it('rejects km above current', () => reject({ at: '2026-09-01', km: 9999 }, /more than the bike's current 3812 km/))
    it('rejects a future date', () => reject({ at: '2999-01-01', hoursTenths: 1200 }, /future/))
    it('rejects an impossible calendar date with 400', () => reject({ at: '2026-02-31' }, /Invalid lastDone date/))
    it('rejects impossible month/day with 400', async () => {
      await reject({ at: '2026-13-45' }, /Invalid lastDone date/)
      await reject({ at: '2026-00-10' }, /Invalid lastDone date/)
    })
    it('accepts values equal to current and today', async () => {
      const today = new Date().toISOString().slice(0, 10)
      await expect(createBike(uid, withLast({ at: today, hoursTenths: 1425, km: 3812 }))).resolves.toBeTruthy()
    })
  })
})
