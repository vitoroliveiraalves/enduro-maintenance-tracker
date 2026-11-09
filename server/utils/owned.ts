import { and, eq } from 'drizzle-orm'
import { createError, type H3Event } from 'h3'
import { db } from '../db/client'
import { bikes, categories, documents, expenses, itemNotes, maintenanceItems, parts, reminders, services, shoppingEntries } from '../db/schema'
import type { Bike, Category, Document, Expense, ItemNote, MaintenanceItem, Part, Reminder, Service, ShoppingEntry } from '../db/schema'
import { requireUser } from './require-user'
import { isUuid } from './validate'

const notFound = () => createError({ statusCode: 404, statusMessage: 'Not found' })

// A malformed id can never match a row; answer 404 without hitting Postgres.

/** Bike `bikeId` if it belongs to the signed-in user, else 404. */
export async function ownedBike(event: H3Event, bikeId: string): Promise<Bike> {
  const user = await requireUser(event)
  if (!isUuid(bikeId)) throw notFound()
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
  if (!isUuid(itemId)) throw notFound()
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
  if (!isUuid(documentId)) throw notFound()
  const [row] = await db
    .select()
    .from(documents)
    .where(and(eq(documents.id, documentId), eq(documents.userId, user.id)))
  if (!row) throw notFound()
  return row
}

export async function ownedExpense(event: H3Event, expenseId: string): Promise<Expense> {
  const user = await requireUser(event)
  if (!isUuid(expenseId)) throw notFound()
  const [row] = await db
    .select()
    .from(expenses)
    .where(and(eq(expenses.id, expenseId), eq(expenses.userId, user.id)))
  if (!row) throw notFound()
  return row
}

export async function ownedService(event: H3Event, serviceId: string): Promise<Service> {
  const user = await requireUser(event)
  if (!isUuid(serviceId)) throw notFound()
  const [row] = await db
    .select()
    .from(services)
    .where(and(eq(services.id, serviceId), eq(services.userId, user.id)))
  if (!row) throw notFound()
  return row
}

export async function ownedCategory(event: H3Event, categoryId: string): Promise<Category> {
  const user = await requireUser(event)
  if (!isUuid(categoryId)) throw notFound()
  const [row] = await db
    .select()
    .from(categories)
    .where(and(eq(categories.id, categoryId), eq(categories.userId, user.id)))
  if (!row) throw notFound()
  return row
}

export async function ownedReminder(event: H3Event, reminderId: string): Promise<Reminder> {
  const user = await requireUser(event)
  if (!isUuid(reminderId)) throw notFound()
  const [row] = await db
    .select()
    .from(reminders)
    .where(and(eq(reminders.id, reminderId), eq(reminders.userId, user.id)))
  if (!row) throw notFound()
  return row
}

export async function ownedNote(event: H3Event, noteId: string): Promise<ItemNote> {
  const user = await requireUser(event)
  if (!isUuid(noteId)) throw notFound()
  const [row] = await db
    .select()
    .from(itemNotes)
    .where(and(eq(itemNotes.id, noteId), eq(itemNotes.userId, user.id)))
  if (!row) throw notFound()
  return row
}

export async function ownedPart(event: H3Event, partId: string): Promise<Part> {
  const user = await requireUser(event)
  if (!isUuid(partId)) throw notFound()
  const [row] = await db
    .select()
    .from(parts)
    .where(and(eq(parts.id, partId), eq(parts.userId, user.id)))
  if (!row) throw notFound()
  return row
}

export async function ownedShoppingEntry(event: H3Event, entryId: string): Promise<ShoppingEntry> {
  const user = await requireUser(event)
  if (!isUuid(entryId)) throw notFound()
  const [row] = await db
    .select()
    .from(shoppingEntries)
    .where(and(eq(shoppingEntries.id, entryId), eq(shoppingEntries.userId, user.id)))
  if (!row) throw notFound()
  return row
}
