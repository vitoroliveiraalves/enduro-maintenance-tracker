import { beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { db } from '../../../server/db/client'
import { bikes, itemNotes, maintenanceItems, meterReadings, services, user } from '../../../server/db/schema'
import { TEMPLATES } from '../../../server/domain/templates'
import { bikeDetail, createBike, createItem, itemRows, listBikes, patchBike, patchItem } from '../../../server/utils/bikes'
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

    expect(detail.specs).toEqual([])
    await db.insert(itemNotes).values({
      clientId: crypto.randomUUID(),
      userId: uid,
      itemId: first.id,
      title: 'Torque specs',
      specs: [{ label: 'Drain bolt', value: '20 Nm' }],
    })
    const withSpecs = await bikeDetail(bike)
    expect(withSpecs.specs).toHaveLength(1)
    expect(withSpecs.specs[0]).toMatchObject({
      itemName: 'Gearbox oil',
      title: 'Torque specs',
      specs: [{ label: 'Drain bolt', value: '20 Nm' }],
    })
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
    it('hours without a date: stored as date unknown, never as a made-up today', async () => {
      const bike = await createBike(uid, withLast({ hoursTenths: 1390 }))
      const [svc] = await db.select().from(services).where(eq(services.bikeId, bike.id))
      expect(svc).toMatchObject({ hoursTenths: 1390, atUnknown: true })
      const [row] = await itemRows(bike.id, uid)
      expect(row!.last).toMatchObject({ hoursTenths: 1390, dateUnknown: true })
      expect(row!.status.sinceHoursTenths).toBe(35)
    })
    it('no date and no meters is not a last-done record', () => reject({}, /Invalid lastDone/))
    it('accepts values equal to current and today', async () => {
      const today = new Date().toISOString().slice(0, 10)
      await expect(createBike(uid, withLast({ at: today, hoursTenths: 1425, km: 3812 }))).resolves.toBeTruthy()
    })
  })

  describe('meters', () => {
    const kmBody = (over: Record<string, unknown> = {}) => {
      const rest: Record<string, unknown> = body()
      delete rest.hoursTenths
      return { ...rest, meters: 'km', items: [{ name: 'Chain', everyHoursTenths: 150, everyKm: 6000 }], ...over }
    }

    it('km bike: first reading has no hours; hours interval is stored null', async () => {
      const bike = await createBike(uid, kmBody({ hoursTenths: 99 }))
      expect(bike.meters).toBe('km')
      const detail = await bikeDetail(bike)
      expect(detail.latestReading).toMatchObject({ hoursTenths: null, km: 3812 })
      const [it] = await db.select().from(maintenanceItems).where(eq(maintenanceItems.bikeId, bike.id))
      expect(it).toMatchObject({ everyHoursTenths: null, everyKm: 6000 })
    })

    it('km bike without km, or with an unknown meters value, is a 400', async () => {
      const noKm = kmBody()
      delete noKm.km
      await expect(createBike(uid, noKm)).rejects.toMatchObject({ statusCode: 400 })
      await expect(createBike(uid, body({ meters: 'street' }))).rejects.toMatchObject({ statusCode: 400, statusMessage: 'Invalid meters' })
      expect(await db.select().from(bikes)).toHaveLength(0)
    })

    it('uncounted last-done meters are ignored; only-uncounted without a date records nothing', async () => {
      const items = [
        { name: 'Chain', everyKm: 6000, lastDone: { at: '2026-09-01', hoursTenths: 1200, km: 3000 } },
        { name: 'Oil', everyKm: 6000, lastDone: { hoursTenths: 1200 } },
      ]
      const bike = await createBike(uid, kmBody({ items }))
      const svc = await db.select().from(services).where(eq(services.bikeId, bike.id))
      expect(svc).toHaveLength(1)
      expect(svc[0]).toMatchObject({ hoursTenths: null, km: 3000 })
    })

    it('switching meters changes status only; switching back restores it', async () => {
      const bike = await createBike(uid, body({
        items: [{ name: 'Gearbox oil', everyHoursTenths: 150, lastDone: { at: '2026-09-01', hoursTenths: 100 } }],
      }))
      await db.insert(meterReadings).values({ bikeId: bike.id, userId: uid, hoursTenths: 250, km: 3900 })
      const now = new Date()
      const before = (await itemRows(bike.id, uid, now))[0]!
      expect(['soon', 'overdue']).toContain(before.status.state)
      const onKm = await patchBike(bike, { meters: 'km' })
      expect(onKm.meters).toBe('km')
      expect((await itemRows(bike.id, uid))[0]!.status.state).toBe('unknown')
      const back = await patchBike(onKm, { meters: 'hours_km' })
      expect((await itemRows(bike.id, uid, now))[0]!).toEqual(before)
      expect(back.meters).toBe('hours_km')
      await expect(patchBike(back, { meters: 'x' })).rejects.toMatchObject({ statusCode: 400, statusMessage: 'Invalid meters' })
      expect(await db.select().from(meterReadings).where(eq(meterReadings.bikeId, bike.id))).toHaveLength(2)
    })

    it('item create strips an uncounted interval; item patch ignores it', async () => {
      const bike = await createBike(uid, kmBody({ items: [] }))
      const a = await createItem(bike, { clientId: crypto.randomUUID(), name: 'Chain', everyHoursTenths: 300, everyKm: 5000 })
      expect(a).toMatchObject({ everyHoursTenths: null, everyKm: 5000 })
      // a stored uncounted interval (e.g. from before a switch) survives a patch that names it
      await db.update(maintenanceItems).set({ everyHoursTenths: 400 }).where(eq(maintenanceItems.id, a.id))
      const patched = await patchItem({ ...a, everyHoursTenths: 400 }, uid, { everyHoursTenths: 999, everyKm: 7000 })
      expect(patched).toMatchObject({ everyHoursTenths: 400, everyKm: 7000 })
    })

    it('manages 2T premixRatio: defaults to 50, updates via patch, validates range', async () => {
      const bike = await createBike(uid, body({ stroke: '2T', items: [] }))
      expect(bike.premixRatio).toBe(50)

      const updated = await patchBike(bike, { premixRatio: 40 })
      expect(updated.premixRatio).toBe(40)

      await expect(patchBike(bike, { premixRatio: 5 })).rejects.toMatchObject({ statusCode: 400 })
      await expect(patchBike(bike, { premixRatio: 150 })).rejects.toMatchObject({ statusCode: 400 })
    })

    it('creates car vehicle: defaults stroke to 4T, meters to km, sets plate and lists vehicleType', async () => {
      const car = await createBike(uid, {
        clientId: crypto.randomUUID(),
        name: 'Daily Golf',
        make: 'Volkswagen',
        model: 'Golf GTI',
        year: 2020,
        vehicleType: 'car',
        plate: 'aa-01-bb',
        km: 45000,
        items: [],
      })
      expect(car.vehicleType).toBe('car')
      expect(car.stroke).toBe('4T')
      expect(car.meters).toBe('km')
      expect(car.plate).toBe('AA-01-BB')
      expect(car.premixRatio).toBeNull()

      const list = await listBikes(uid)
      const carSummary = list.find((b) => b.id === car.id)
      expect(carSummary).toMatchObject({
        vehicleType: 'car',
        plate: 'AA-01-BB',
      })

      const patched = await patchBike(car, { plate: '99-ZZ-88', name: 'Track Golf', model: 'Golf R', notes: 'Stage 1 remap, 19-inch tyres' })
      expect(patched.plate).toBe('99-ZZ-88')
      expect(patched.name).toBe('Track Golf')
      expect(patched.model).toBe('Golf R')
      expect(patched.notes).toBe('Stage 1 remap, 19-inch tyres')

      const cleared = await patchBike(car, { notes: '' })
      expect(cleared.notes).toBeNull()
    })
  })
})
