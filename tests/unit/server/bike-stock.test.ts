import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../../server/db/client'
import { partItems, parts, user } from '../../../server/db/schema'
import { createBike, itemRows } from '../../../server/utils/bikes'
import { truncateUsers } from '../../support/truncate'

let uid: string, other: string
let bikeId: string
let oilId: string, chainId: string

const link = async (userId: string, name: string, q: number, itemId: string) => {
  const [p] = await db.insert(parts).values({ userId, clientId: crypto.randomUUID(), name, qtyHundredths: q }).returning()
  await db.insert(partItems).values({ partId: p!.id, itemId })
  return p!
}
const stockOf = async (id: string) => (await itemRows(bikeId, uid)).find((r) => r.id === id)!.stock

beforeEach(async () => {
  await truncateUsers()
  const [u, o] = await db.insert(user).values([{ name: 'A', email: 'a@example.com' }, { name: 'B', email: 'b@example.com' }]).returning()
  uid = u!.id
  other = o!.id
  const bike = await createBike(uid, {
    clientId: crypto.randomUUID(), name: 'KTM', make: 'KTM', model: '300', year: 2022, stroke: '2T', hoursTenths: 100, km: 0,
    items: [{ name: 'Oil', everyHoursTenths: 150 }, { name: 'Chain', everyHoursTenths: 150 }],
  })
  bikeId = bike.id
  const rows = await itemRows(bikeId, uid)
  oilId = rows.find((r) => r.name === 'Oil')!.id
  chainId = rows.find((r) => r.name === 'Chain')!.id
})

describe('itemRows stock', () => {
  it('is null when no part is linked', async () => {
    expect(await stockOf(oilId)).toBeNull()
  })
  it('is "in" when every linked part has a count above zero', async () => {
    await link(uid, 'Filter', 100, oilId)
    await link(uid, 'Gasket', 200, oilId)
    expect(await stockOf(oilId)).toBe('in')
    expect(await stockOf(chainId)).toBeNull()
  })
  it('is "none" when any linked part is at zero or below', async () => {
    await link(uid, 'Filter', 100, oilId)
    await link(uid, 'Gasket', 0, oilId)
    expect(await stockOf(oilId)).toBe('none')
    await link(uid, 'Chain lube', -100, chainId)
    expect(await stockOf(chainId)).toBe('none')
  })
  it('ignores another user\'s parts', async () => {
    await link(other, 'Foreign', 0, oilId)
    expect(await stockOf(oilId)).toBeNull()
  })
})
