import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../../server/db/client'
import { user } from '../../../server/db/schema'
import { createBike, itemRows } from '../../../server/utils/bikes'
import { createCategory } from '../../../server/utils/categories'
import { createPart } from '../../../server/utils/parts'
import { validateProposals } from '../../../server/utils/voice-proposals'
import { truncateUsers } from '../../support/truncate'

let uid: string, other: string
beforeEach(async () => {
  await truncateUsers()
  const [u, o] = await db.insert(user).values([{ name: 'A', email: 'a@example.com' }, { name: 'B', email: 'b@example.com' }]).returning()
  uid = u!.id
  other = o!.id
})
const bike = (userId: string, over: Record<string, unknown> = {}) => createBike(userId, {
  clientId: crypto.randomUUID(), name: 'KTM', make: 'KTM', model: '300', year: 2022, stroke: '2T', hoursTenths: 100, km: 1000,
  items: [{ name: 'Gearbox oil', everyHoursTenths: 200 }], ...over,
})

describe('validateProposals', () => {
  it('drops a foreign bikeId (card gets an empty picker) and keeps owned candidates', async () => {
    const mine = await bike(uid)
    const mine2 = await bike(uid, { name: 'Beta' })
    const theirs = await bike(other)
    const r = await validateProposals(uid, [
      { kind: 'reading', bikeId: theirs.id, hoursTenths: 120 },
      { kind: 'reading', candidates: [mine.id, theirs.id, mine2.id, 'junk'], km: 1100 },
    ])
    expect(r.notes).toEqual([])
    expect(r.proposals[0]).toEqual({ kind: 'reading', candidates: [], hoursTenths: 120 })
    expect(r.proposals[1]).toEqual({ kind: 'reading', candidates: [mine.id, mine2.id], km: 1100 })
    expect(JSON.stringify(r)).not.toContain(theirs.id)
  })

  it('rejects hoursTenths 1.5 and an impossible date, with a note', async () => {
    const mine = await bike(uid)
    const item = (await itemRows(mine.id, uid))[0]!
    const r = await validateProposals(uid, [
      { kind: 'reading', bikeId: mine.id, hoursTenths: 1.5 },
      { kind: 'service', bikeId: mine.id, itemIds: [item.id], at: '2026-02-30', by: 'diy' },
      { kind: 'service', bikeId: mine.id, itemIds: [item.id], at: '2026-02-28', by: 'garage', garageName: 'Moto Braga' },
    ])
    expect(r.proposals).toEqual([{ kind: 'service', bikeId: mine.id, itemIds: [item.id], at: '2026-02-28', by: 'garage', garageName: 'Moto Braga' }])
    expect(r.notes).toHaveLength(2)
    expect(r.notes[0]).toMatch(/^Couldn't understand: reading/)
  })

  it('drops uncounted meters, foreign items and foreign parts', async () => {
    const street = await bike(uid, { meters: 'km', hoursTenths: undefined, items: [{ name: 'Chain', everyKm: 1000 }] })
    const theirs = await bike(other)
    const theirItem = (await itemRows(theirs.id, other))[0]!
    const myItem = (await itemRows(street.id, uid))[0]!
    const part = await createPart(db, uid, { clientId: crypto.randomUUID(), name: 'Gasket', startClientId: crypto.randomUUID() })
    const theirPart = await createPart(db, other, { clientId: crypto.randomUUID(), name: 'Gasket', startClientId: crypto.randomUUID() })
    const r = await validateProposals(uid, [
      { kind: 'reading', bikeId: street.id, hoursTenths: 50 },
      { kind: 'service', bikeId: street.id, itemIds: [theirItem.id, myItem.id], at: '2026-01-02', hoursTenths: 9, km: 1200,
        partsUsed: [{ partId: part.id, qtyHundredths: 100 }, { partId: theirPart.id, qtyHundredths: 100 }] },
      { kind: 'use_part', partId: theirPart.id, qtyHundredths: 100 },
      { kind: 'shopping', text: 'Grips', bikeId: theirs.id },
    ])
    expect(r.notes).toEqual(["Couldn't understand: reading (no meter value)"])
    expect(r.proposals).toEqual([
      { kind: 'service', bikeId: street.id, itemIds: [myItem.id], at: '2026-01-02', by: 'diy', km: 1200, partsUsed: [{ partId: part.id, qtyHundredths: 100 }] },
      { kind: 'use_part', candidates: [], qtyHundredths: 100 },
      { kind: 'shopping', text: 'Grips' },
    ])
  })

  it('checks expense, reminder and add_part fields like the real routes', async () => {
    const cat = await createCategory(uid, { clientId: crypto.randomUUID(), name: 'Fuel', kind: 'fuel' })
    const r = await validateProposals(uid, [
      { kind: 'expense', amountCents: 1500, categoryId: cat.id, at: '2026-03-01', description: 'Fuel' },
      { kind: 'expense', amountCents: 0, categoryId: cat.id, at: '2026-03-01' },
      { kind: 'reminder', title: 'Insurance', dueOn: '2026-12-01' },
      { kind: 'add_part', name: 'Air filter', qtyHundredths: 200 },
      { kind: 'nonsense' },
      'not an object',
    ])
    expect(r.proposals).toEqual([
      { kind: 'expense', amountCents: 1500, categoryId: cat.id, at: '2026-03-01', description: 'Fuel' },
      { kind: 'reminder', title: 'Insurance', dueOn: '2026-12-01', repeatYearly: false },
      { kind: 'add_part', name: 'Air filter', unit: 'pcs', qtyHundredths: 200 },
    ])
    expect(r.notes).toHaveLength(3)
  })
})
