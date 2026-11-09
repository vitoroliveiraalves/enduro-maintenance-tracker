import { beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { db } from '../../../server/db/client'
import { partMovements, parts, services, user } from '../../../server/db/schema'
import type { Part } from '../../../server/db/schema'
import { createBike, itemRows } from '../../../server/utils/bikes'
import { createService, deleteService, listServices } from '../../../server/utils/services'
import { itemHistory } from '../../../server/utils/item-history'
import { truncateUsers } from '../../support/truncate'

let uid: string, other: string
let bike: Awaited<ReturnType<typeof createBike>>
let itemId: string
let plug: Part, oil: Part

const day = new Date().toISOString().slice(0, 10)
const count = async (p: Part) => (await db.select().from(parts).where(eq(parts.id, p.id)))[0]!.qtyHundredths
const svc = (over: Record<string, unknown> = {}) =>
  createService(bike, { clientId: crypto.randomUUID(), at: day, by: 'diy', itemIds: [itemId], ...over })
const use = (p: Part, q: number, over: Record<string, unknown> = {}) => ({ clientId: crypto.randomUUID(), partId: p.id, qtyHundredths: q, ...over })
const mk = async (name: string, q: number, userId = uid) =>
  (await db.insert(parts).values({ userId, clientId: crypto.randomUUID(), name, unit: name === 'Oil' ? 'l' : 'pcs', qtyHundredths: q }).returning())[0]!

beforeEach(async () => {
  await truncateUsers()
  const [u, o] = await db.insert(user).values([{ name: 'A', email: 'a@example.com' }, { name: 'B', email: 'b@example.com' }]).returning()
  uid = u!.id
  other = o!.id
  bike = await createBike(uid, { clientId: crypto.randomUUID(), name: 'KTM', make: 'KTM', model: '300', year: 2022, stroke: '2T', hoursTenths: 100, km: 0, items: [{ name: 'Oil', everyHoursTenths: 150 }] })
  itemId = (await itemRows(bike.id, uid))[0]!.id
  plug = await mk('Plug', 300)
  oil = await mk('Oil', 1000)
})

describe('partsUsed', () => {
  it('a service with two parts lowers both counts', async () => {
    await svc({ partsUsed: [use(plug, 100), use(oil, 250)] })
    expect(await count(plug)).toBe(200)
    expect(await count(oil)).toBe(750)
    const [row] = await listServices(uid)
    expect(row!.partsUsed).toEqual(expect.arrayContaining([
      { name: 'Plug', qtyHundredths: 100, unit: 'pcs' },
      { name: 'Oil', qtyHundredths: 250, unit: 'l' },
    ]))
    const m = await db.select().from(partMovements)
    expect(m.every((x) => x.kind === 'used' && x.at === day && x.serviceId)).toBe(true)
  })

  it('a replay of the same service clientId lowers nothing more', async () => {
    const body = { clientId: crypto.randomUUID(), partsUsed: [use(plug, 100)] }
    await svc(body)
    await svc(body)
    expect(await count(plug)).toBe(200)
    expect(await db.select().from(services)).toHaveLength(1)
    expect(await db.select().from(partMovements)).toHaveLength(1)
  })

  it('a part deleted before the service arrives still saves, with the snapshot name', async () => {
    const gone = await mk('Old plug', 100)
    await db.delete(parts).where(eq(parts.id, gone.id))
    await svc({ partsUsed: [use(gone, 100, { partName: 'Old plug' }), use(gone, 100, { partId: crypto.randomUUID() })] })
    const [row] = await listServices(uid)
    expect(row!.partsUsed.map((p) => p.name).sort()).toEqual(['Old plug', 'Removed part'])
    const hist = await itemHistory(itemId, uid)
    expect(hist.services[0]!.partsUsed).toHaveLength(2)
  })

  it('another user\'s part is treated as removed and left untouched', async () => {
    const theirs = await mk('Theirs', 500, other)
    await svc({ partsUsed: [use(theirs, 100)] })
    expect(await count(theirs)).toBe(500)
    expect((await listServices(uid))[0]!.partsUsed[0]!.name).toBe('Removed part')
  })

  it('deleting a service used past zero restores the exact start count', async () => {
    await svc({ partsUsed: [use(plug, 700)] })
    expect(await count(plug)).toBe(-400)
    const [row] = await listServices(uid)
    await deleteService((await db.select().from(services).where(eq(services.id, row!.id)))[0]!)
    expect(await count(plug)).toBe(300)
    expect(await db.select().from(partMovements)).toHaveLength(0)
  })

  it('rejects bad lines and saves nothing', async () => {
    const bads = [
      [use(plug, 0)], [use(plug, -5)], [use(plug, 1.5)], [use(plug, 100, { partId: 'nope' })], [use(plug, 100, { clientId: 'x' })],
      'x', {}, [null], Array.from({ length: 21 }, () => use(plug, 1)), [use(plug, 1), use(plug, 2)],
      [use(plug, 1, { partName: 'x'.repeat(81) })],
    ]
    for (const partsUsed of bads) await expect(svc({ partsUsed })).rejects.toMatchObject({ statusCode: 400 })
    expect(await db.select().from(services)).toHaveLength(0)
    expect(await count(plug)).toBe(300)
  })
})
