import { eq } from 'drizzle-orm'
import { db } from '../db/client'
import { user } from '../db/schema'

/**
 * Deletes the user row in one transaction; every table that holds the rider's
 * data (sessions, bikes, readings, services, expenses, documents + files,
 * reminders, push subscriptions, sent-notification log) cascades from it.
 */
export async function deleteAccount(userId: string) {
  await db.transaction(async (tx) => {
    await tx.delete(user).where(eq(user.id, userId))
  })
}
