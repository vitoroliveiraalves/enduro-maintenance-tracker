import { count, desc, eq, sql, type SQL } from 'drizzle-orm'
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core'
import { createError, type H3Event } from 'h3'
import { db } from '../db/client'
import { bikes, documents, expenses, meterReadings, parts, services, user } from '../db/schema'
import { requireUser } from './require-user'

/** NUXT_ADMIN_EMAILS: comma-separated, case-insensitive. */
export function adminEmails(raw: unknown): Set<string> {
  return new Set(
    String(raw ?? '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  )
}

export const isAdminEmail = (email: string, raw: unknown) => adminEmails(raw).has(email.trim().toLowerCase())

export function isAdmin(event: H3Event, email: string): boolean {
  return isAdminEmail(email, useRuntimeConfig(event).adminEmails)
}

/** The signed-in admin, else 404 (the admin screen does not exist for anyone else). */
export async function requireAdmin(event: H3Event) {
  const u = await requireUser(event)
  if (!isAdmin(event, u.email)) throw createError({ statusCode: 404, statusMessage: 'Not found' })
  return u
}

/** Beta AI features on for this account (default on). */
export async function aiEnabled(userId: string): Promise<boolean> {
  const [row] = await db.select({ on: user.aiEnabled }).from(user).where(eq(user.id, userId))
  return row?.on ?? false
}

export type AdminRider = {
  id: string
  email: string
  createdAt: string
  lastLoginAt: string | null
  aiEnabled: boolean
  counts: { bikes: number; services: number; expenses: number; invoices: number; readings: number; parts: number }
}

/** Per-user row counts of one table, as a map. */
async function countBy(table: PgTable, col: PgColumn, where?: SQL) {
  const rows = await db.select({ userId: col, n: count() }).from(table).where(where).groupBy(col)
  return new Map(rows.map((r) => [r.userId as string, r.n]))
}

export async function listRiders(): Promise<AdminRider[]> {
  const users = await db
    .select({ id: user.id, email: user.email, createdAt: user.createdAt, lastLoginAt: user.lastLoginAt, aiEnabled: user.aiEnabled })
    .from(user)
    .orderBy(sql`${user.lastLoginAt} desc nulls last`, desc(user.createdAt))
  const [b, s, e, d, p, r] = await Promise.all([
    countBy(bikes, bikes.userId),
    countBy(services, services.userId),
    countBy(expenses, expenses.userId),
    // Saved invoices only: unsaved uploads are not usage yet.
    countBy(documents, documents.userId, eq(documents.status, 'confirmed')),
    countBy(parts, parts.userId),
    countBy(meterReadings, meterReadings.userId),
  ])
  return users.map((u) => ({
    id: u.id,
    email: u.email,
    createdAt: u.createdAt.toISOString(),
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    aiEnabled: u.aiEnabled,
    counts: {
      bikes: b.get(u.id) ?? 0,
      services: s.get(u.id) ?? 0,
      expenses: e.get(u.id) ?? 0,
      invoices: d.get(u.id) ?? 0,
      readings: r.get(u.id) ?? 0,
      parts: p.get(u.id) ?? 0,
    },
  }))
}
