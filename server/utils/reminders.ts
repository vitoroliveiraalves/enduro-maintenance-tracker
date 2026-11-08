import { and, asc, eq, inArray, isNull, or } from 'drizzle-orm'
import { db } from '../db/client'
import { bikes, notificationsSent, reminders } from '../db/schema'
import type { Bike, Reminder } from '../db/schema'
import { isObj, realDate, str } from './bikes'
import { bad, uuid } from './validate'

export const REMINDER_PRESETS = ['Insurance', 'IUC', 'Inspection', 'Licence'] as const

export type ReminderRow = {
  id: string
  bikeId: string | null
  bikeName: string | null
  title: string
  dueOn: string
  repeatYearly: boolean
  doneAt: string | null
}

/** dueOn must be exactly "YYYY-MM-DD" and a real day (future dates are the point here). */
function dueOn(v: unknown): string {
  if (typeof v !== 'string' || v.length !== 10) throw bad('Invalid dueOn date')
  return realDate(v, 'dueOn')
}

function repeat(v: unknown): boolean {
  if (v === undefined) return false
  if (typeof v !== 'boolean') throw bad('Invalid repeatYearly')
  return v
}

/** Same day next year; 29 Feb rolls to 28 Feb. */
export function rollYear(day: string): string {
  const [y, m, d] = day.split('-')
  const next = `${Number(y) + 1}-${m}-${m === '02' && d === '29' ? '28' : d}`
  return next
}

const toRow = (r: Reminder, bikeName: string | null): ReminderRow => ({
  id: r.id,
  bikeId: r.bikeId,
  bikeName,
  title: r.title,
  dueOn: r.dueOn,
  repeatYearly: r.repeatYearly,
  doneAt: r.doneAt ? r.doneAt.toISOString() : null,
})

/** Re-arm the 7d / 0d pushes after the due date moved. */
async function rearm(userId: string, reminderId: string) {
  await db
    .delete(notificationsSent)
    .where(and(eq(notificationsSent.userId, userId), inArray(notificationsSent.key, [`reminder:${reminderId}:7d`, `reminder:${reminderId}:0d`])))
}

/** Open reminders of the user, soonest first. With `bikeId`: that bike's plus the bike-less ones. */
export async function listReminders(userId: string, bikeId?: string): Promise<ReminderRow[]> {
  const rows = await db
    .select({ r: reminders, bikeName: bikes.name })
    .from(reminders)
    .leftJoin(bikes, eq(reminders.bikeId, bikes.id))
    .where(
      and(
        eq(reminders.userId, userId),
        isNull(reminders.doneAt),
        bikeId ? or(eq(reminders.bikeId, bikeId), isNull(reminders.bikeId)) : undefined,
      ),
    )
    .orderBy(asc(reminders.dueOn), asc(reminders.createdAt))
  return rows.map(({ r, bikeName }) => toRow(r, bikeName))
}

async function rowOf(userId: string, id: string): Promise<ReminderRow> {
  const [row] = await db
    .select({ r: reminders, bikeName: bikes.name })
    .from(reminders)
    .leftJoin(bikes, eq(reminders.bikeId, bikes.id))
    .where(and(eq(reminders.id, id), eq(reminders.userId, userId)))
  return toRow(row!.r, row!.bikeName)
}

/** `bike` (when given) must already be ownership-checked. A replayed clientId creates nothing. */
export async function createReminder(userId: string, bike: Bike | null, raw: unknown): Promise<ReminderRow> {
  if (!isObj(raw)) throw bad('Invalid body')
  if (raw.bikeId != null && typeof raw.bikeId !== 'string') throw bad('Invalid bikeId')
  const clientId = uuid(raw.clientId)
  const values = { userId, clientId, bikeId: bike?.id ?? null, title: str(raw.title, 'title'), dueOn: dueOn(raw.dueOn), repeatYearly: repeat(raw.repeatYearly) }
  const [row] = await db.insert(reminders).values(values).onConflictDoNothing({ target: [reminders.userId, reminders.clientId] }).returning()
  if (row) return rowOf(userId, row.id)
  const [existing] = await db.select().from(reminders).where(and(eq(reminders.userId, userId), eq(reminders.clientId, clientId)))
  return rowOf(userId, existing!.id)
}

/** `bike` is the ownership-checked new bike when `raw.bikeId` is a string; `bikeId: null` clears it. */
export async function patchReminder(userId: string, r: Reminder, bike: Bike | null, raw: unknown): Promise<ReminderRow> {
  if (!isObj(raw)) throw bad('Invalid body')
  const set: Partial<typeof reminders.$inferInsert> = {}
  if (raw.title !== undefined) set.title = str(raw.title, 'title')
  if (raw.dueOn !== undefined) set.dueOn = dueOn(raw.dueOn)
  if (raw.repeatYearly !== undefined) set.repeatYearly = repeat(raw.repeatYearly)
  if (raw.bikeId === null) set.bikeId = null
  else if (raw.bikeId !== undefined) {
    if (typeof raw.bikeId !== 'string' || !bike) throw bad('Invalid bikeId')
    set.bikeId = bike.id
  }
  if (Object.keys(set).length) {
    await db.update(reminders).set(set).where(and(eq(reminders.id, r.id), eq(reminders.userId, userId)))
    if (set.dueOn && set.dueOn !== r.dueOn) await rearm(userId, r.id)
  }
  return rowOf(userId, r.id)
}

/**
 * Yearly reminders roll to the same day next year; one-offs get `doneAt`.
 * When the body carries the `dueOn` the rider saw, a replay (double tap,
 * offline retry) whose dueOn no longer matches changes nothing.
 */
export async function markReminderDone(userId: string, r: Reminder | ReminderRow, raw: unknown): Promise<ReminderRow> {
  const seen = isObj(raw) && raw.dueOn !== undefined ? dueOn(raw.dueOn) : null
  const [cur] = await db.select().from(reminders).where(and(eq(reminders.id, r.id), eq(reminders.userId, userId)))
  if (!cur) throw bad('Invalid reminder')
  if ((seen && seen !== cur.dueOn) || cur.doneAt) return rowOf(userId, cur.id)
  const set = cur.repeatYearly ? { dueOn: rollYear(cur.dueOn) } : { doneAt: new Date() }
  // Guard on the old dueOn so two concurrent taps roll only once.
  await db.update(reminders).set(set).where(and(eq(reminders.id, cur.id), eq(reminders.userId, userId), eq(reminders.dueOn, cur.dueOn), isNull(reminders.doneAt)))
  await rearm(userId, cur.id)
  return rowOf(userId, cur.id)
}

export async function deleteReminder(userId: string, id: string) {
  await db.delete(reminders).where(and(eq(reminders.id, id), eq(reminders.userId, userId)))
  await rearm(userId, id)
}
