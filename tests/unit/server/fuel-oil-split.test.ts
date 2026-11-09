import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { db } from '../../../server/db/client'
import { categories, expenses, user } from '../../../server/db/schema'
import { DEFAULT_CATEGORIES } from '../../../server/utils/categories-seed'

const SPLIT = readFileSync('server/db/migrations/0002_split_fuel_oil.sql', 'utf8')
const runSplit = async () => {
  for (const stmt of SPLIT.split('--> statement-breakpoint')) if (stmt.trim()) await db.execute(sql.raw(stmt))
}

beforeEach(async () => {
  await db.execute(sql`TRUNCATE "user" CASCADE`)
})

describe('fuel and oil are separate categories', () => {
  it('new riders get "Fuel" and "Oil & fluids"', () => {
    const byKind = Object.fromEntries(DEFAULT_CATEGORIES.map((c) => [c.kind, c.name]))
    expect(byKind.fuel).toBe('Fuel')
    expect(byKind.oil).toBe('Oil & fluids')
  })

  it('the migration splits an existing rider\'s "Fuel & 2T oil" and keeps their expenses and renames', async () => {
    const [a, b] = await db.insert(user).values([{ name: 'A', email: 'a@example.com' }, { name: 'B', email: 'b@example.com' }]).returning()
    // A still has the old seed; B renamed it and already made an oil category.
    const [fuelA] = await db.insert(categories).values({ userId: a!.id, name: 'Fuel & 2T oil', kind: 'fuel' }).returning()
    await db.insert(categories).values([
      { userId: b!.id, name: 'Gasolina', kind: 'fuel' },
      { userId: b!.id, name: 'Óleos', kind: 'oil' },
    ])
    await db.insert(expenses).values({ userId: a!.id, at: '2026-11-01', amountCents: 4160, categoryId: fuelA!.id })

    await runSplit()
    await runSplit() // idempotent

    const rows = await db.select({ userId: categories.userId, name: categories.name, kind: categories.kind }).from(categories)
    const of = (id: string) => rows.filter((r) => r.userId === id).map((r) => `${r.kind}:${r.name}`).sort()
    expect(of(a!.id)).toEqual(['fuel:Fuel', 'oil:Oil & fluids'])
    expect(of(b!.id)).toEqual(['fuel:Gasolina', 'oil:Óleos'])
    const [e] = await db.select().from(expenses)
    expect(e!.categoryId).toBe(fuelA!.id)
  })
})
