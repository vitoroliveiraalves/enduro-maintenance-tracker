import { beforeEach, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { db } from '../../../server/db/client'
import { categories, expenses, meterReadings, user } from '../../../server/db/schema'
import { DEFAULT_CATEGORIES } from '../../../server/utils/categories-seed'
import { createBike, itemRows } from '../../../server/utils/bikes'
import { createService } from '../../../server/utils/services'
import { listCategories } from '../../../server/utils/categories'
import { compareRanges, comparePct, costsCsv, costsOverview, csvCell, periodRange, readingsDelta } from '../../../server/domain/costs-query'

let uid: string, other: string, cat: string
let bike: Awaited<ReturnType<typeof createBike>>
const NOW = new Date('2026-11-08T10:00:00Z')

const exp = (at: string, amountCents: number, o: Partial<typeof expenses.$inferInsert> = {}) =>
  db.insert(expenses).values({ userId: uid, clientId: crypto.randomUUID(), at, amountCents, categoryId: cat, bikeId: bike.id, description: 'x', ...o })
const reading = (at: string, hoursTenths: number, km: number, bikeId = bike.id, userId = uid) =>
  db.insert(meterReadings).values({ bikeId, userId, at: new Date(`${at}T12:00:00Z`), hoursTenths, km })

beforeEach(async () => {
  await db.execute(sql`TRUNCATE "user" CASCADE`)
  const [u, o] = await db.insert(user).values([{ name: 'A', email: 'a@example.com' }, { name: 'B', email: 'b@example.com' }]).returning()
  uid = u!.id
  other = o!.id
  await db.insert(categories).values(DEFAULT_CATEGORIES.map((c) => ({ ...c, userId: uid })))
  cat = (await listCategories(uid))[0]!.id
  bike = await createBike(uid, {
    clientId: crypto.randomUUID(), name: 'KTM', make: 'KTM', model: '300', year: 2022, stroke: '2T', hoursTenths: 0, km: 0,
    items: [{ name: 'Oil', everyHoursTenths: 100, lastDone: { at: '2026-01-02', hoursTenths: 0, km: 0 } }],
  })
  await db.delete(meterReadings)
})

describe('pure helpers', () => {
  it('period boundaries are calendar dates', () => {
    expect(periodRange('month', '2026-02-10')).toEqual({ from: '2026-02-01', to: '2026-02-28' })
    expect(periodRange('year', '2026-06-01')).toEqual({ from: '2026-01-01', to: '2026-12-31' })
    expect(periodRange('all', '2026-06-01')).toEqual({ from: null, to: null })
  })
  it('compare ranges: to today this year, whole year for past years', () => {
    expect(compareRanges('2026-03-01', NOW)).toEqual({
      current: { from: '2026-01-01', to: '2026-11-08' }, previous: { from: '2025-01-01', to: '2025-11-08' },
    })
    expect(compareRanges('2025-03-01', NOW).current.to).toBe('2025-12-31')
    expect(compareRanges('2025-03-01', NOW).previous.to).toBe('2024-12-31')
    expect(compareRanges('2024-03-01', new Date('2024-02-29T00:00:00Z')).previous.to).toBe('2023-02-28')
  })
  it('pct rounds, null on zero previous', () => {
    expect(comparePct(2486, 2107)).toBe(18)
    expect(comparePct(5, 0)).toBeNull()
  })
  it('readingsDelta uses the last reading before the start, else the first inside', () => {
    const rs = [
      { day: '2026-09-20', hoursTenths: 100, km: 10 },
      { day: '2026-10-01', hoursTenths: 130, km: 20 },
      { day: '2026-10-31', hoursTenths: 200, km: 50 },
    ]
    expect(readingsDelta(rs, { from: '2026-10-01', to: '2026-10-31' })).toEqual({ hoursTenths: 100, km: 40 })
    expect(readingsDelta(rs.slice(1), { from: '2026-10-01', to: '2026-10-31' })).toEqual({ hoursTenths: 70, km: 30 })
    expect(readingsDelta([], { from: '2026-10-01', to: '2026-10-31' })).toEqual({ hoursTenths: 0, km: 0 })
  })
  it('csv cells are quoted and defused', () => {
    expect(csvCell('=SUM(A1)')).toBe(`"'=SUM(A1)"`)
    expect(csvCell('-1')).toBe(`"'-1"`)
    expect(csvCell('say "hi"; ok')).toBe('"say ""hi""; ok"')
  })
})

describe('costsOverview', () => {
  it('year to date vs same day last year: pct 18 for 2 486 vs 2 107', async () => {
    await exp('2026-03-10', 150_000)
    await exp('2026-10-01', 98_600)
    await exp('2025-04-01', 100_000)
    await exp('2025-11-08', 110_700)
    await exp('2025-12-20', 90_000) // after the same day last year: excluded from the comparison
    const r = await costsOverview(uid, { period: 'year', date: '2026-06-01' }, NOW)
    expect(r.totalCents).toBe(248_600)
    expect(r.compare).toEqual({ previousToDateCents: 210_700, pct: 18 })
    expect(r.byMonth).toHaveLength(12)
    expect(r.byMonth![2]).toEqual({ month: 3, cents: 150_000 })
    expect(r.expenses).toBeUndefined()
  })
  it('compare is null pct when last year was empty, and absent outside year', async () => {
    await exp('2026-03-10', 1000)
    expect((await costsOverview(uid, { period: 'year', date: '2026-01-01' }, NOW)).compare).toEqual({ previousToDateCents: 0, pct: null })
    expect((await costsOverview(uid, { period: 'month', date: '2026-03-01' }, NOW)).compare).toBeNull()
  })
  it('per-hour is null with no hours; computed from reading deltas otherwise', async () => {
    await exp('2026-10-05', 61_200)
    let r = await costsOverview(uid, { period: 'month', date: '2026-10-15' }, NOW)
    expect(r.perHourCents).toBeNull()
    expect(r.perKmCents).toBeNull()
    await reading('2026-09-28', 1000, 3000)
    await reading('2026-10-31', 1140, 3280)
    r = await costsOverview(uid, { period: 'month', date: '2026-10-15' }, NOW)
    expect(r.hoursTenths).toBe(140)
    expect(r.km).toBe(280)
    expect(r.perHourCents).toBe(4371) // 612 / 14 h
    expect(r.perKmCents).toBe(219)
  })
  it('month view lists only that month, with category totals desc', async () => {
    await exp('2026-10-01', 1000, { description: 'first of month' })
    await exp('2026-10-31', 2000, { description: 'last of month' })
    await exp('2026-09-30', 5000)
    await exp('2026-11-01', 7000)
    const r = await costsOverview(uid, { period: 'month', date: '2026-10-15' }, NOW)
    expect(r.totalCents).toBe(3000)
    expect(r.expenses!.map((e) => e.description)).toEqual(['last of month', 'first of month'])
    expect(r.byCategory).toEqual([{ categoryId: cat, name: expect.any(String), cents: 3000 }])
    expect(r.byMonth).toBeUndefined()
  })
  it('all bikes: no-bike expenses count in total and appear as "No bike"; one bike excludes them', async () => {
    await exp('2026-10-05', 1000)
    await exp('2026-10-06', 400, { bikeId: null })
    const all = await costsOverview(uid, { period: 'month', date: '2026-10-15' }, NOW)
    expect(all.totalCents).toBe(1400)
    expect(all.byBike.map((b) => [b.name, b.cents])).toEqual([['KTM', 1000], ['No bike', 400]])
    const one = await costsOverview(uid, { period: 'month', date: '2026-10-15', bikeId: bike.id }, NOW)
    expect(one.totalCents).toBe(1000)
  })
  it('upcoming: estimate from the last service lines, null when none', async () => {
    const [oil] = await itemRows(bike.id, uid)
    await createService(bike, {
      clientId: crypto.randomUUID(), at: '2026-02-01', hoursTenths: 0, km: 0, by: 'diy', itemIds: [oil!.id],
      expenses: [{ amountCents: 2500, categoryId: cat, description: 'oil' }, { amountCents: 490, categoryId: cat, description: 'filter' }],
    })
    await reading('2026-10-20', 1200, 3000) // 120 h on a 100 h interval
    const r = await costsOverview(uid, { period: 'month', date: '2026-10-15', bikeId: bike.id }, NOW)
    expect(r.upcoming).toEqual([{ itemId: oil!.id, name: 'Oil', state: 'overdue', estimateCents: 2990 }])
    const all = await costsOverview(uid, { period: 'month', date: '2026-10-15' }, NOW)
    expect(all.upcoming).toBeUndefined()
    const yr = await costsOverview(uid, { period: 'year', date: '2026-10-15', bikeId: bike.id }, NOW)
    expect(yr.upcoming).toBeUndefined()
  })
  it('upcoming estimate is null with no priced service', async () => {
    const [oil] = await itemRows(bike.id, uid)
    await reading('2026-10-20', 1200, 3000)
    const r = await costsOverview(uid, { period: 'month', date: '2026-10-15', bikeId: bike.id }, NOW)
    expect(r.upcoming).toEqual([{ itemId: oil!.id, name: 'Oil', state: 'overdue', estimateCents: null }])
  })
  it('is scoped by user and 404s a bike that is not owned', async () => {
    await exp('2026-10-05', 1000)
    const [oc] = await db.insert(categories).values({ userId: other, name: 'X', kind: 'parts' }).returning()
    await db.insert(expenses).values({ userId: other, clientId: crypto.randomUUID(), at: '2026-10-05', amountCents: 999_999, categoryId: oc!.id })
    expect((await costsOverview(uid, { period: 'all', date: '2026-10-05' }, NOW)).totalCents).toBe(1000)
    await expect(costsOverview(other, { period: 'all', date: '2026-10-05', bikeId: bike.id }, NOW)).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe('costsCsv', () => {
  it('BOM, semicolons, comma decimals, injection guard, period filter', async () => {
    await exp('2026-10-05', 2490, { description: '=HYPERLINK("x")' })
    await exp('2026-09-05', 100)
    const csv = await costsCsv(uid, { period: 'month', date: '2026-10-01' })
    expect(csv.charCodeAt(0)).toBe(0xfeff)
    const lines = csv.slice(1).trim().split('\r\n')
    expect(lines[0]).toBe('"date";"bike";"category";"description";"amount_eur";"invoice_number"')
    expect(lines).toHaveLength(2)
    expect(lines[1]).toContain(`"2026-10-05";"KTM";`)
    expect(lines[1]).toContain(`"'=HYPERLINK(""x"")";"24,90";""`)
  })
})
