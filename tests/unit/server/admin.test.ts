import { beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { db } from '../../../server/db/client'
import * as s from '../../../server/db/schema'
import { adminEmails, aiEnabled, isAdminEmail, listRiders } from '../../../server/utils/admin'
import { createBike } from '../../../server/utils/bikes'
import { truncateUsers } from '../../support/truncate'

describe('admin emails', () => {
  it('parses a comma list, trimmed and case-insensitive', () => {
    expect([...adminEmails(' Mail@Example.pt , ,other@x.com')]).toEqual(['mail@example.pt', 'other@x.com'])
    expect(isAdminEmail('MAIL@example.pt', 'mail@example.pt')).toBe(true)
    expect(isAdminEmail('mail@example.pt', '')).toBe(false)
    expect(isAdminEmail('mail@example.pt', undefined)).toBe(false)
  })
})

describe('riders list', () => {
  beforeEach(truncateUsers)

  it('counts each rider apart, AI on by default, most recent login first', async () => {
    const [a] = await db.insert(s.user).values({ name: 'a', email: 'a@x.com', lastLoginAt: new Date('2026-01-01') }).returning()
    const [b] = await db.insert(s.user).values({ name: 'b', email: 'b@x.com', lastLoginAt: new Date('2026-06-01') }).returning()
    const [c] = await db.insert(s.user).values({ name: 'c', email: 'c@x.com' }).returning()
    await createBike(a!.id, { clientId: crypto.randomUUID(), name: 'KTM', make: 'KTM', model: '300', year: 2022, stroke: '2T', hoursTenths: 100, km: 100, items: [] })
    await db.insert(s.documents).values([{ userId: a!.id, status: 'confirmed' }, { userId: a!.id, status: 'review' }])
    await db.update(s.user).set({ aiEnabled: false }).where(eq(s.user.id, b!.id))

    const riders = await listRiders()
    expect(riders.map((r) => r.email)).toEqual(['b@x.com', 'a@x.com', 'c@x.com'])
    const ra = riders.find((r) => r.id === a!.id)!
    expect(ra.counts.bikes).toBe(1)
    expect(ra.counts.invoices).toBe(1) // saved only
    expect(ra.counts.readings).toBeGreaterThanOrEqual(1) // the starting reading
    expect(riders.find((r) => r.id === c!.id)!.counts).toEqual({ bikes: 0, services: 0, expenses: 0, invoices: 0, readings: 0, parts: 0 })
    expect(await aiEnabled(a!.id)).toBe(true)
    expect(await aiEnabled(b!.id)).toBe(false)
    expect(await aiEnabled(crypto.randomUUID())).toBe(false)
  })
})
