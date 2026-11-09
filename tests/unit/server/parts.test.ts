import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../../server/db/client'
import { partMovements, parts, shoppingEntries, user } from '../../../server/db/schema'
import type { Part } from '../../../server/db/schema'
import { applyMovement, qty } from '../../../server/utils/parts'
import { truncateUsers } from '../../support/truncate'

let uid: string
let part: Part

const move = (over: Record<string, unknown> = {}) =>
  db.transaction((tx) =>
    applyMovement(tx, {
      userId: uid, clientId: crypto.randomUUID(), part, partName: part.name, unit: part.unit,
      kind: 'bought', qtyHundredths: 100, at: '2026-11-09', ...over,
    }),
  )
const count = async () => (await db.select().from(parts).where(eq(parts.id, part.id)))[0]!.qtyHundredths

beforeEach(async () => {
  await truncateUsers()
  const [u] = await db.insert(user).values({ name: 'A', email: 'a@example.com' }).returning()
  uid = u!.id
  ;[part] = await db.insert(parts).values({ userId: uid, clientId: crypto.randomUUID(), name: 'Spark plug', qtyHundredths: 300 }).returning()
})

describe('applyMovement', () => {
  it('adds to the count', async () => {
    expect(await move({ qtyHundredths: 200 })).toEqual({ applied: true })
    expect(await count()).toBe(500)
  })

  it('replaying the same clientId leaves the count unchanged', async () => {
    const clientId = crypto.randomUUID()
    expect(await move({ clientId })).toEqual({ applied: true })
    expect(await move({ clientId })).toEqual({ applied: false })
    expect(await count()).toBe(400)
    expect(await db.select().from(partMovements)).toHaveLength(1)
  })

  it('two movements (+100, -100) end at the start count', async () => {
    await move({ qtyHundredths: 100 })
    await move({ kind: 'used', qtyHundredths: -100 })
    expect(await count()).toBe(300)
  })

  it('a used movement past zero gives a negative count', async () => {
    await move({ kind: 'used', qtyHundredths: -500 })
    expect(await count()).toBe(-200)
  })

  it('a null part inserts the movement and changes nothing else', async () => {
    expect(await move({ part: null, partName: 'Gone part' })).toEqual({ applied: true })
    const rows = await db.select().from(partMovements)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ partId: null, partName: 'Gone part' })
    expect(await count()).toBe(300)
  })

  it('a bought movement ticks a linked open shopping entry, not an unlinked one', async () => {
    const [linked] = await db.insert(shoppingEntries).values({ userId: uid, clientId: crypto.randomUUID(), text: 'Plug', partId: part.id }).returning()
    const [free] = await db.insert(shoppingEntries).values({ userId: uid, clientId: crypto.randomUUID(), text: 'Beer' }).returning()
    await move({ kind: 'used', qtyHundredths: -100 })
    expect((await db.select().from(shoppingEntries).where(eq(shoppingEntries.id, linked!.id)))[0]!.doneAt).toBeNull()
    await move()
    expect((await db.select().from(shoppingEntries).where(eq(shoppingEntries.id, linked!.id)))[0]!.doneAt).not.toBeNull()
    expect((await db.select().from(shoppingEntries).where(eq(shoppingEntries.id, free!.id)))[0]!.doneAt).toBeNull()
  })
})

describe('qty', () => {
  it('accepts integer hundredths within range', () => {
    expect(qty(150, 'qty')).toBe(150)
    expect(qty(1_000_000, 'qty')).toBe(1_000_000)
    expect(qty(-250, 'qty', { allowNegative: true })).toBe(-250)
  })
  it.each([1.5, '12', null, 1_000_001])('rejects %s', (v) => {
    expect(() => qty(v, 'qty')).toThrow(/Invalid qty/)
  })
  it('rejects negatives unless allowed', () => {
    expect(() => qty(-1, 'qty')).toThrow()
    expect(() => qty(-1_000_001, 'qty', { allowNegative: true })).toThrow()
  })
})
