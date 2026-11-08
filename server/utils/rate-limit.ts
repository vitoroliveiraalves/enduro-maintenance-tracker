import { createError } from 'h3'

/**
 * Tiny in-memory sliding-window rate limiter, ported from encomentio. Good
 * enough for a single-node deploy; if we scale out, move the buckets to Postgres.
 */
const buckets = new Map<string, number[]>()

function hitsIn(key: string, windowMs: number, now: number) {
  const cutoff = now - windowMs
  return (buckets.get(key) ?? []).filter((t) => t > cutoff)
}

function gc(now: number) {
  // Cheap guard against unbounded growth under abuse (no window here is longer than a day).
  if (buckets.size <= 10_000) return
  for (const [k, v] of buckets) if (!v.some((t) => t > now - DAY_MS)) buckets.delete(k)
}

/** Returns ms-until-retry when blocked, or null when allowed (and records a hit). */
export function rateLimit(key: string, max: number, windowMs: number, now = Date.now()): number | null {
  const hits = hitsIn(key, windowMs, now)
  if (hits.length >= max) return windowMs - (now - hits[0]!)
  hits.push(now)
  buckets.set(key, hits)
  gc(now)
  return null
}

/** Each read is a paid model call: cap the damage from a stuck client or a busy day. */
export const READS_MAX = 60
export const READS_WINDOW_MS = 10 * 60_000
export const DAY_MS = 24 * 3_600_000
export const DAILY_LIMIT_COPY = 'Daily invoice reading limit reached — you can still add the lines yourself.'

/**
 * 60 reads / user / 10 min and `dailyCap` / user / 24 h. Both windows are checked
 * before either records, so a refused read never uses up the allowance.
 */
export function assertReadAllowed(userId: string, dailyCap: number, now = Date.now()) {
  const shortKey = `invoice-read:${userId}`
  const dayKey = `invoice-read-day:${userId}`
  const short = hitsIn(shortKey, READS_WINDOW_MS, now)
  const day = hitsIn(dayKey, DAY_MS, now)
  if (day.length >= dailyCap) throw createError({ statusCode: 429, statusMessage: DAILY_LIMIT_COPY })
  if (short.length >= READS_MAX) {
    const wait = Math.ceil((READS_WINDOW_MS - (now - short[0]!)) / 60_000)
    throw createError({ statusCode: 429, statusMessage: `Too many invoice reads — try again in ${wait} min, or add the lines yourself.` })
  }
  buckets.set(shortKey, [...short, now])
  buckets.set(dayKey, [...day, now])
  gc(now)
}
