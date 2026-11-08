import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { createError } from 'h3'
import { db } from '../db/client'
import { expenses, maintenanceItems, serviceItems, services } from '../db/schema'
import { itemRows } from './bikes'
import { isUuid } from './validate'

/** One item's status plus every service that reset it, highest hours first. `userId` scopes everything. */
export async function itemHistory(itemId: string, userId: string) {
  if (!isUuid(itemId)) throw createError({ statusCode: 404, statusMessage: 'Not found' })
  const [found] = await db
    .select({ bikeId: maintenanceItems.bikeId })
    .from(maintenanceItems)
    .where(and(eq(maintenanceItems.id, itemId), eq(maintenanceItems.userId, userId)))
  const row = found && (await itemRows(found.bikeId, userId)).find((r) => r.id === itemId)
  if (!found || !row) throw createError({ statusCode: 404, statusMessage: 'Not found' })

  const list = await db
    .select({ s: services })
    .from(serviceItems)
    .innerJoin(services, eq(serviceItems.serviceId, services.id))
    .where(and(eq(serviceItems.itemId, itemId), eq(services.userId, userId)))
    .orderBy(sql`${services.hoursTenths} desc nulls last`, desc(services.at), desc(services.createdAt))
  const ids = list.map((x) => x.s.id)
  const totals = ids.length
    ? await db
        .select({ serviceId: expenses.serviceId, total: sql<number>`sum(${expenses.amountCents})::int` })
        .from(expenses)
        .where(and(eq(expenses.userId, userId), inArray(expenses.serviceId, ids)))
        .groupBy(expenses.serviceId)
    : []
  return {
    item: { ...row, bikeId: found.bikeId },
    status: row.status,
    services: list.map(({ s }) => ({
      id: s.id,
      at: s.at,
      hoursTenths: s.hoursTenths,
      km: s.km,
      by: s.by,
      garageName: s.garageName,
      costCents: totals.find((t) => t.serviceId === s.id)?.total ?? 0,
      documentId: s.documentId,
    })),
  }
}
