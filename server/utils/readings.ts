import { and, asc, desc, eq, gt, lte } from 'drizzle-orm'
import { db } from '../db/client'
import { meterReadings } from '../db/schema'
import type { Bike } from '../db/schema'
import { validateBeforeLater, validateReading } from '../domain/reading-validation'
import { bikeDetail } from './bikes'
import { bad, int, timestamp, uuid } from './validate'

const CONDITIONS = ['normal', 'mud', 'sand', 'dust', 'race'] as const

const meters = (r: { hoursTenths: number; km: number }) => ({ hoursTenths: r.hoursTenths, km: r.km })

export function parseReadingInput(raw: unknown) {
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
    hoursTenths: int(o.hoursTenths, 'hoursTenths'),
    km: int(o.km, 'km'),
    condition: condition as (typeof CONDITIONS)[number],
    confirmBigJump: o.confirmBigJump === true,
  }
}

export type LogResult =
  | { status: 200; body: Awaited<ReturnType<typeof bikeDetail>> }
  | { status: 409 | 422; body: Record<string, unknown> }

/** Validate against the neighbours in time and save. `bike` must already be ownership-checked. */
export async function logReading(bike: Bike, raw: unknown): Promise<LogResult> {
  const input = parseReadingInput(raw)
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
    .orderBy(desc(meterReadings.at), desc(meterReadings.hoursTenths))
    .limit(1)
  const [later = null] = await db
    .select()
    .from(meterReadings)
    .where(and(scope, gt(meterReadings.at, input.at)))
    .orderBy(asc(meterReadings.at), asc(meterReadings.hoursTenths))
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
    .orderBy(desc(meterReadings.at), desc(meterReadings.hoursTenths))
}
