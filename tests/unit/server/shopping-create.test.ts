import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../../server/db/client'
import { bikes, parts, shoppingEntries, user } from '../../../server/db/schema'
import { createEntry } from '../../../server/utils/shopping'
import { truncateUsers } from '../../support/truncate'

let uid: string

beforeEach(async () => {
  await truncateUsers()
  const [u] = await db.insert(user).values({ name: 'A', email: 'a@example.com' }).returning()
  uid = u!.id
})

describe('createEntry replay', () => {
  it('returns the existing row for a replayed clientId even after its bike and part were deleted', async () => {
    const [bike] = await db.insert(bikes).values({ userId: uid, clientId: crypto.randomUUID(), name: 'KTM', make: 'KTM', model: '300', year: 2023, stroke: '2T' } as never).returning()
    const [part] = await db.insert(parts).values({ userId: uid, clientId: crypto.randomUUID(), name: 'Chain' }).returning()
    const clientId = crypto.randomUUID()
    const body = { clientId, text: 'Chain lube', bikeId: bike!.id, partId: part!.id }
    const first = await db.transaction((tx) => createEntry(tx, uid, body))
    await db.delete(parts).where(eq(parts.id, part!.id))
    await db.delete(bikes).where(eq(bikes.id, bike!.id))
    const again = await db.transaction((tx) => createEntry(tx, uid, body))
    expect(again.id).toBe(first.id)
    expect(await db.select().from(shoppingEntries)).toHaveLength(1)
  })
})
