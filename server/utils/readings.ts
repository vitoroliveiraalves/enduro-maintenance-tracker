import { and, asc, count, desc, eq, gt, lte } from 'drizzle-orm'
import { db } from '../db/client'
import { meterReadings } from '../db/schema'
import type { Bike } from '../db/schema'
import { validateBeforeLater, validateReading } from '../domain/reading-validation'
import { bikeDetail, hoursAsc, hoursDesc, latestReading } from './bikes'
import { countsHours, countsKm } from '../../shared/utils/meters'
import type { BikeMeters } from '../../shared/utils/meters'
import { createError } from 'h3'
import { bad, int, timestamp, uuid } from './validate'

const CONDITIONS = ['normal', 'mud', 'sand', 'dust', 'race'] as const

const meters = (r: { hoursTenths: number | null; km: number | null }) => ({ hoursTenths: r.hoursTenths, km: r.km })

/** Counted meters are required; an uncounted one is ignored (stored null). A bike without hours has no riding conditions. */
export function parseReadingInput(raw: unknown, bikeMeters: BikeMeters) {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw bad('Invalid body')
  const o = raw as Record<string, unknown>
  const clientId = uuid(o.clientId)
  const condition = o.condition === undefined ? 'normal' : o.condition
  if (!CONDITIONS.includes(condition as (typeof CONDITIONS)[number])) throw bad('Invalid condition')
  let at = new Date()
  if (o.at !== undefined && o.at !== null) {
    at = timestamp(o.at)
    // one day of slack for server/client timezone differences
    if (at.getTime() > Date.now() + 86_400_000) throw bad('Date is in the future')
    // Within that slack, a client clock running ahead never stores a future reading.
    if (at.getTime() > Date.now()) at = new Date()
  }
  return {
    clientId,
    at,
    hoursTenths: countsHours(bikeMeters) ? int(o.hoursTenths, 'hoursTenths') : null,
    km: countsKm(bikeMeters) ? int(o.km, 'km') : null,
    condition: (countsHours(bikeMeters) ? condition : 'normal') as (typeof CONDITIONS)[number],
    confirmBigJump: o.confirmBigJump === true,
  }
}

export type LogResult =
  | { status: 200; body: Awaited<ReturnType<typeof bikeDetail>> }
  | { status: 409 | 422; body: Record<string, unknown> }

/** Validate against the neighbours in time and save. `bike` must already be ownership-checked. */
export async function logReading(bike: Bike, raw: unknown): Promise<LogResult> {
  const input = parseReadingInput(raw, bike.meters)
  const scope = and(eq(meterReadings.bikeId, bike.id), eq(meterReadings.userId, bike.userId))

  // Replay: the stored reading wins, validation does not run again.
  const [existing] = await db
    .select()
    .from(meterReadings)
    .where(and(eq(meterReadings.userId, bike.userId), eq(meterReadings.clientId, input.clientId)))
  if (existing) return { status: 200, body: await bikeDetail(bike) }

  const [prev = null] = await db
    .select()
    .from(meterReadings)
    .where(and(scope, lte(meterReadings.at, input.at)))
    .orderBy(desc(meterReadings.at), hoursDesc)
    .limit(1)
  const [later = null] = await db
    .select()
    .from(meterReadings)
    .where(and(scope, gt(meterReadings.at, input.at)))
    .orderBy(asc(meterReadings.at), hoursAsc)
    .limit(1)

  const next = meters(input)
  const check = validateReading(prev, next)
  if (!check.ok) return { status: 422, body: { error: check.error, last: prev && meters(prev) } }
  const order = validateBeforeLater(later, next)
  if (!order.ok) return { status: 422, body: { error: order.error, last: later && meters(later) } }
  if (check.warn && !input.confirmBigJump) return { status: 409, body: { warn: check.warn, last: prev && meters(prev) } }

  await db
    .insert(meterReadings)
    .values({ bikeId: bike.id, userId: bike.userId, clientId: input.clientId, at: input.at, ...next, condition: input.condition })
    .onConflictDoNothing({ target: [meterReadings.userId, meterReadings.clientId] })
  return { status: 200, body: await bikeDetail(bike) }
}

export async function listReadings(bike: Bike) {
  return db
    .select()
    .from(meterReadings)
    .where(and(eq(meterReadings.bikeId, bike.id), eq(meterReadings.userId, bike.userId)))
    .orderBy(desc(meterReadings.at), hoursDesc)
}

/**
 * Undo a typo: delete the bike's latest reading, named by id so a replay (or a
 * stale screen) never removes the one before it. The first reading stays: it
 * is the bike's starting point. A reading already gone is a no-op.
 */
export async function undoLatestReading(bike: Bike, raw: unknown) {
  const readingId = uuid((raw as { readingId?: unknown } | null)?.readingId, 'readingId')
  const scope = and(eq(meterReadings.bikeId, bike.id), eq(meterReadings.userId, bike.userId))
  const [target] = await db.select().from(meterReadings).where(and(scope, eq(meterReadings.id, readingId)))
  if (!target) return bikeDetail(bike)
  const latest = await latestReading(bike.id, bike.userId)
  if (latest?.id !== target.id) throw createError({ statusCode: 409, statusMessage: 'Only the latest reading can be undone.' })
  const [{ n } = { n: 0 }] = await db.select({ n: count() }).from(meterReadings).where(scope)
  if (n <= 1) throw createError({ statusCode: 409, statusMessage: "The bike's first reading can't be undone." })
  await db.delete(meterReadings).where(and(scope, eq(meterReadings.id, target.id)))
  return bikeDetail(bike)
}
