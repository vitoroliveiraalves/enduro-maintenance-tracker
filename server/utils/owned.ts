import { and, eq } from 'drizzle-orm'
import { createError, type H3Event } from 'h3'
import { db } from '../db/client'
import { bikes, categories, documents, expenses, maintenanceItems, reminders, services } from '../db/schema'
import type { Bike, Category, Document, Expense, MaintenanceItem, Reminder, Service } from '../db/schema'
import { requireUser } from './require-user'

const notFound = () => createError({ statusCode: 404, statusMessage: 'Not found' })

// A malformed id can never match a row; answer 404 without hitting Postgres.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Bike `bikeId` if it belongs to the signed-in user, else 404. */
export async function ownedBike(event: H3Event, bikeId: string): Promise<Bike> {
  const user = await requireUser(event)
  if (!UUID.test(bikeId)) throw notFound()
  const [row] = await db
    .select()
    .from(bikes)
    .where(and(eq(bikes.id, bikeId), eq(bikes.userId, user.id)))
  if (!row) throw notFound()
  return row
}

/** Maintenance item of one of the user's bikes (joined through the bike), else 404. */
export async function ownedItem(event: H3Event, itemId: string): Promise<MaintenanceItem> {
  const user = await requireUser(event)
  if (!UUID.test(itemId)) throw notFound()
  const [row] = await db
    .select({ item: maintenanceItems })
    .from(maintenanceItems)
    .innerJoin(bikes, eq(maintenanceItems.bikeId, bikes.id))
    .where(and(eq(maintenanceItems.id, itemId), eq(bikes.userId, user.id)))
  if (!row) throw notFound()
  return row.item
}

export async function ownedDocument(event: H3Event, documentId: string): Promise<Document> {
  const user = await requireUser(event)
  if (!UUID.test(documentId)) throw notFound()
  const [row] = await db
    .select()
    .from(documents)
    .where(and(eq(documents.id, documentId), eq(documents.userId, user.id)))
  if (!row) throw notFound()
  return row
}

export async function ownedExpense(event: H3Event, expenseId: string): Promise<Expense> {
  const user = await requireUser(event)
  if (!UUID.test(expenseId)) throw notFound()
  const [row] = await db
    .select()
    .from(expenses)
    .where(and(eq(expenses.id, expenseId), eq(expenses.userId, user.id)))
  if (!row) throw notFound()
  return row
}

export async function ownedService(event: H3Event, serviceId: string): Promise<Service> {
  const user = await requireUser(event)
  if (!UUID.test(serviceId)) throw notFound()
  const [row] = await db
    .select()
    .from(services)
    .where(and(eq(services.id, serviceId), eq(services.userId, user.id)))
  if (!row) throw notFound()
  return row
}

export async function ownedCategory(event: H3Event, categoryId: string): Promise<Category> {
  const user = await requireUser(event)
  if (!UUID.test(categoryId)) throw notFound()
  const [row] = await db
    .select()
    .from(categories)
    .where(and(eq(categories.id, categoryId), eq(categories.userId, user.id)))
  if (!row) throw notFound()
  return row
}

export async function ownedReminder(event: H3Event, reminderId: string): Promise<Reminder> {
  const user = await requireUser(event)
  if (!UUID.test(reminderId)) throw notFound()
  const [row] = await db
    .select()
    .from(reminders)
    .where(and(eq(reminders.id, reminderId), eq(reminders.userId, user.id)))
  if (!row) throw notFound()
  return row
}
