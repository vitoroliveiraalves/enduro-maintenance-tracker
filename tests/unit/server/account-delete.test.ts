import { beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { db } from '../../../server/db/client'
import * as s from '../../../server/db/schema'
import { DEFAULT_CATEGORIES } from '../../../server/utils/categories-seed'
import { createBike, itemRows } from '../../../server/utils/bikes'
import { listCategories } from '../../../server/utils/categories'
import { createExpense } from '../../../server/utils/expenses'
import { createService } from '../../../server/utils/services'
import { createReminder } from '../../../server/utils/reminders'
import { deleteAccount } from '../../../server/utils/account'
import { truncateUsers } from '../../support/truncate'

const USER_TABLES = {
  session: s.session, account: s.account, documents: s.documents, documentFiles: s.documentFiles, bikes: s.bikes,
  meterReadings: s.meterReadings, maintenanceItems: s.maintenanceItems, services: s.services, categories: s.categories,
  expenses: s.expenses, reminders: s.reminders, pushSubscriptions: s.pushSubscriptions, notificationsSent: s.notificationsSent,
} as const

async function seedEverything(email: string) {
  const [u] = await db.insert(s.user).values({ name: 'x', email }).returning()
  const userId = u!.id
  await db.insert(s.session).values({ userId, token: crypto.randomUUID(), expiresAt: new Date(Date.now() + 86_400_000) })
  await db.insert(s.account).values({ userId, accountId: userId, providerId: 'credential', password: 'hash' })
  await db.insert(s.categories).values(DEFAULT_CATEGORIES.map((c) => ({ ...c, userId })))
  const [doc] = await db.insert(s.documents).values({ userId, status: 'confirmed' }).returning()
  await db.insert(s.documentFiles).values({ documentId: doc!.id, userId, mime: 'image/jpeg', bytes: Buffer.from('jpg'), sha256: crypto.randomUUID() })
  const bike = await createBike(userId, {
    clientId: crypto.randomUUID(), name: 'KTM', make: 'KTM', model: '300', year: 2022, stroke: '2T', hoursTenths: 100, km: 100,
    items: [{ name: 'Oil', everyHoursTenths: 150 }],
  })
  await db.update(s.bikes).set({ photoDocumentId: doc!.id }).where(eq(s.bikes.id, bike.id))
  const [item] = await itemRows(bike.id, userId)
  const cat = (await listCategories(userId))[0]!.id
  await createService(bike, {
    clientId: crypto.randomUUID(), at: '2026-01-01', hoursTenths: 50, km: 50, by: 'diy', itemIds: [item!.id], documentId: doc!.id,
    expenses: [{ amountCents: 100, categoryId: cat, description: 'Oil' }],
  })
  await db.update(s.expenses).set({ documentId: doc!.id }).where(eq(s.expenses.userId, userId))
  await createExpense(userId, bike, { clientId: crypto.randomUUID(), at: '2026-01-01', amountCents: 100, categoryId: cat, itemIds: [item!.id] })
  await createReminder(userId, bike, { clientId: crypto.randomUUID(), title: 'IUC', dueOn: '2027-01-01' })
  await db.insert(s.pushSubscriptions).values({ userId, endpoint: `https://fcm.googleapis.com/fcm/send/${crypto.randomUUID()}`, p256dh: 'k', auth: 'a' })
  await db.insert(s.notificationsSent).values({ userId, key: 'nudge:2026-W45' })
  return userId
}

async function counts(userId: string) {
  const out: Record<string, number> = {}
  for (const [name, t] of Object.entries(USER_TABLES)) {
    const rows = await db.select().from(t).where(eq(t.userId, userId))
    out[name] = rows.length
  }
  out.serviceItems = (await db.select().from(s.serviceItems).innerJoin(s.services, eq(s.serviceItems.serviceId, s.services.id)).where(eq(s.services.userId, userId))).length
  return out
}

beforeEach(async () => {
  await truncateUsers()
})

describe('deleteAccount', () => {
  it('removes the user and every row they own, and leaves other riders alone', async () => {
    const victim = await seedEverything('gone@example.com')
    const keeper = await seedEverything('stay@example.com')
    const before = await counts(victim)
    expect(Object.values(before).every((n) => n > 0), JSON.stringify(before)).toBe(true)

    await deleteAccount(victim)

    expect(await db.select().from(s.user).where(eq(s.user.id, victim))).toHaveLength(0)
    expect(Object.values(await counts(victim)).every((n) => n === 0)).toBe(true)
    expect(await db.select().from(s.expenseItems)).toHaveLength(2) // only the keeper's two
    expect(await counts(keeper)).toEqual(before)
  })
})
