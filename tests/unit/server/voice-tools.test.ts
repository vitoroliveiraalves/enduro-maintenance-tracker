import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../../server/db/client'
import { user } from '../../../server/db/schema'
import { createBike, itemRows } from '../../../server/utils/bikes'
import { createService } from '../../../server/utils/services'
import { createCategory } from '../../../server/utils/categories'
import { createExpense } from '../../../server/utils/expenses'
import { createPart } from '../../../server/utils/parts'
import { createReminder } from '../../../server/utils/reminders'
import { createEntry } from '../../../server/utils/shopping'
import { runTool, VOICE_TOOLS } from '../../../server/utils/voice-tools'
import { truncateUsers } from '../../support/truncate'

let uid: string, other: string
const day = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString().slice(0, 10)
const ahead = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10)

beforeEach(async () => {
  await truncateUsers()
  const [u, o] = await db.insert(user).values([{ name: 'A', email: 'a@example.com' }, { name: 'B', email: 'b@example.com' }]).returning()
  uid = u!.id
  other = o!.id
})

async function seed() {
  const ktm = await createBike(uid, {
    clientId: crypto.randomUUID(), name: 'KTM', make: 'KTM', model: '300', year: 2022, stroke: '2T', hoursTenths: 1420, km: 3800,
    items: [{ name: 'Gearbox oil', everyHoursTenths: 200, lastDone: { at: day(50), hoursTenths: 1300, km: 3500 } }],
  })
  const cb = await createBike(uid, {
    clientId: crypto.randomUUID(), name: 'CB', make: 'Honda', model: 'CB500F', year: 2020, stroke: '4T', meters: 'km', km: 12000,
    items: [{ name: 'Chain', everyKm: 1000 }],
  })
  const item = (await itemRows(ktm.id, uid))[0]!
  const cat = await createCategory(uid, { clientId: crypto.randomUUID(), name: 'Bits', kind: 'parts' })
  await createService(ktm, {
    clientId: crypto.randomUUID(), at: day(5), hoursTenths: 1400, km: 3790, by: 'garage', garageName: 'Moto Braga', itemIds: [item.id],
    expenses: [{ amountCents: 4500, categoryId: cat.id, description: 'oil' }],
  })
  await createExpense(uid, ktm, { clientId: crypto.randomUUID(), at: day(0), amountCents: 1000, categoryId: cat.id, description: 'x' })
  await createPart(db, uid, { clientId: crypto.randomUUID(), name: 'Junta escape', unit: 'pcs', qtyHundredths: 200, startClientId: crypto.randomUUID() })
  await createPart(db, uid, { clientId: crypto.randomUUID(), name: 'Air filter', qtyHundredths: 100, startClientId: crypto.randomUUID() })
  await createReminder(uid, ktm, { clientId: crypto.randomUUID(), title: 'Insurance', dueOn: ahead(20) })
  await createEntry(db, uid, { clientId: crypto.randomUUID(), text: 'Grips' })
  return { ktm, cb, item }
}

describe('voice tools', () => {
  it('declares one schema per tool', () => {
    expect(VOICE_TOOLS.map((t) => t.function.name).sort()).toEqual(
      ['costs', 'item_history', 'item_status', 'list_bikes', 'reminders', 'search_shelf', 'shopping_list'],
    )
  })

  it('list_bikes returns meters and only counted values', async () => {
    const { ktm, cb } = await seed()
    const { ref, result } = await runTool(uid, 'list_bikes', {})
    expect(ref).toMatch(/^list_bikes#\d+$/)
    const list = result as Array<Record<string, unknown>>
    expect(list.find((b) => b.id === ktm.id)).toMatchObject({ name: 'KTM', meters: 'hours_km', hoursTenths: 1420, km: 3800 })
    const street = list.find((b) => b.id === cb.id)!
    expect(street).toMatchObject({ meters: 'km', km: 12000 })
    expect(street).not.toHaveProperty('hoursTenths')
  })

  it('item_status gives state, since and last done; omits uncounted units', async () => {
    const { ktm, cb } = await seed()
    const r = (await runTool(uid, 'item_status', { bikeId: ktm.id })).result as { meters: string; items: Array<Record<string, unknown>> }
    expect(r.meters).toBe('hours_km')
    expect(r.items[0]).toMatchObject({ name: 'Gearbox oil', state: 'ok', sinceHoursTenths: 20, lastDone: { hoursTenths: 1400 } })
    const s = (await runTool(uid, 'item_status', { bikeId: cb.id })).result as { items: Array<Record<string, unknown>> }
    expect(s.items[0]).toMatchObject({ name: 'Chain', state: 'unknown', interval: { everyKm: 1000 } })
    expect(s.items[0]).not.toHaveProperty('sinceHoursTenths')
  })

  it('unknown or foreign ids → not found, never a throw', async () => {
    const { ktm, item } = await seed()
    expect((await runTool(other, 'item_status', { bikeId: ktm.id })).result).toEqual({ error: 'not found' })
    expect((await runTool(uid, 'item_status', { bikeId: 'nope' })).result).toEqual({ error: 'not found' })
    expect((await runTool(other, 'item_history', { itemId: item.id })).result).toEqual({ error: 'not found' })
    expect((await runTool(other, 'costs', { period: 'all', bikeId: ktm.id })).result).toEqual({ error: 'not found' })
    expect((await runTool(uid, 'no_such_tool', {})).result).toEqual({ error: 'unknown tool' })
  })

  it('item_history lists services with cost, capped by limit', async () => {
    const { item } = await seed()
    const r = (await runTool(uid, 'item_history', { itemId: item.id, limit: 1 })).result as Array<Record<string, unknown>>
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ hoursTenths: 1400, km: 3790, by: 'garage', garageName: 'Moto Braga', totalCents: 4500, partsUsed: [] })
  })

  it('search_shelf matches without accents or case', async () => {
    await seed()
    const r = (await runTool(uid, 'search_shelf', { query: 'junta' })).result as Array<{ name: string }>
    expect(r.map((p) => p.name)).toEqual(['Junta escape'])
    expect((await runTool(other, 'search_shelf', { query: 'junta' })).result).toEqual([])
  })

  it('shopping_list, reminders and costs return the rider data', async () => {
    const { ktm } = await seed()
    const shop = (await runTool(uid, 'shopping_list', {})).result as { manual: Array<{ text: string }> }
    expect(shop.manual.map((m) => m.text)).toEqual(['Grips'])
    const rem = (await runTool(uid, 'reminders', {})).result as Array<{ title: string }>
    expect(rem.map((x) => x.title)).toEqual(['Insurance'])
    const all = (await runTool(uid, 'costs', { period: 'all' })).result as { totalCents: number; byCategory: Array<{ name: string; cents: number }> }
    expect(all.totalCents).toBe(5500)
    expect(all.byCategory).toEqual([{ name: 'Bits', kind: 'parts', cents: 5500 }])
    const fuel = (await runTool(uid, 'costs', { period: 'all', bikeId: ktm.id, categoryKind: 'fuel' })).result as { totalCents: number }
    expect(fuel.totalCents).toBe(0)
    expect((await runTool(uid, 'costs', { period: 'week' })).result).toEqual({ error: 'invalid period' })
  })

  it('refs are unique per call sequence', async () => {
    await seed()
    const a = await runTool(uid, 'reminders', {})
    const b = await runTool(uid, 'reminders', {})
    expect(a.ref).not.toBe(b.ref)
  })
})
