import { createError } from 'h3'

/**
 * Tiny in-memory sliding-window rate limiter, ported from encomentio. Good
 * enough for a single-node deploy; if we scale out, move the buckets to Postgres.
 */
const buckets = new Map<string, number[]>()

function hitsIn(key: string, windowMs: number, now: number) {
  const cutoff = now - windowMs
  return (buckets.get(key) ?? []).filter((t) => t > cutoff && t <= now)
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
export const GLOBAL_LIMIT_COPY = 'Invoice reading is busy today — you can still add the lines yourself.'
export const GLOBAL_DAILY_CAP = 300

/**
 * A global `globalCap` / 24 h (open registration must not multiply the per-user
 * caps), then 60 reads / user / 10 min and `dailyCap` / user / 24 h. Every window
 * is checked before any records, so a refused read never uses up an allowance.
 */
export function assertReadAllowed(userId: string, dailyCap: number, now = Date.now(), globalCap = GLOBAL_DAILY_CAP) {
  const globalKey = 'invoice-read-global'
  const shortKey = `invoice-read:${userId}`
  const dayKey = `invoice-read-day:${userId}`
  const all = hitsIn(globalKey, DAY_MS, now)
  if (all.length >= globalCap) throw createError({ statusCode: 429, statusMessage: GLOBAL_LIMIT_COPY })
  const short = hitsIn(shortKey, READS_WINDOW_MS, now)
  const day = hitsIn(dayKey, DAY_MS, now)
  if (day.length >= dailyCap) throw createError({ statusCode: 429, statusMessage: DAILY_LIMIT_COPY })
  if (short.length >= READS_MAX) {
    const wait = Math.ceil((READS_WINDOW_MS - (now - short[0]!)) / 60_000)
    throw createError({ statusCode: 429, statusMessage: `Too many invoice reads — try again in ${wait} min, or add the lines yourself.` })
  }
  buckets.set(shortKey, [...short, now])
  buckets.set(dayKey, [...day, now])
  buckets.set(globalKey, [...all, now])
  gc(now)
}

export const VOICE_DAILY_COPY = 'Daily voice limit reached — you can still use the app as usual.'
export const VOICE_GLOBAL_COPY = 'Voice is busy today — you can still use the app as usual.'
export const VOICE_SHORT_MAX = 20
export const VOICE_DAILY_CAP = 60
export const VOICE_GLOBAL_DAILY_CAP = 600

/** Same shape as `assertReadAllowed`, separate buckets: global/24 h, 20 / user / 10 min, `dailyCap` / user / 24 h. */
export function assertVoiceAllowed(userId: string, dailyCap = VOICE_DAILY_CAP, now = Date.now(), globalCap = VOICE_GLOBAL_DAILY_CAP) {
  const globalKey = 'voice-global'
  const shortKey = `voice:${userId}`
  const dayKey = `voice-day:${userId}`
  const all = hitsIn(globalKey, DAY_MS, now)
  if (all.length >= globalCap) throw createError({ statusCode: 429, statusMessage: VOICE_GLOBAL_COPY })
  const day = hitsIn(dayKey, DAY_MS, now)
  if (day.length >= dailyCap) throw createError({ statusCode: 429, statusMessage: VOICE_DAILY_COPY })
  const short = hitsIn(shortKey, READS_WINDOW_MS, now)
  if (short.length >= VOICE_SHORT_MAX) {
    const wait = Math.ceil((READS_WINDOW_MS - (now - short[0]!)) / 60_000)
    throw createError({ statusCode: 429, statusMessage: `Too many voice notes — try again in ${wait} min.` })
  }
  buckets.set(shortKey, [...short, now])
  buckets.set(dayKey, [...day, now])
  buckets.set(globalKey, [...all, now])
  gc(now)
}

export const SCAN_DAILY_COPY = 'Daily scan limit reached — you can still type the numbers.'
export const SCAN_GLOBAL_COPY = 'Photo scanning is busy today — you can still type the numbers.'
export const SCAN_SHORT_MAX = 20
export const SCAN_DAILY_CAP = 60
export const SCAN_GLOBAL_DAILY_CAP = 600

/** Scan rate limiter: global/24 h, 20 / user / 10 min, `dailyCap` / user / 24 h. */
export function assertScanAllowed(userId: string, dailyCap = SCAN_DAILY_CAP, now = Date.now(), globalCap = SCAN_GLOBAL_DAILY_CAP) {
  const globalKey = 'scan-global'
  const shortKey = `scan:${userId}`
  const dayKey = `scan-day:${userId}`
  const all = hitsIn(globalKey, DAY_MS, now)
  if (all.length >= globalCap) throw createError({ statusCode: 429, statusMessage: SCAN_GLOBAL_COPY })
  const day = hitsIn(dayKey, DAY_MS, now)
  if (day.length >= dailyCap) throw createError({ statusCode: 429, statusMessage: SCAN_DAILY_COPY })
  const short = hitsIn(shortKey, READS_WINDOW_MS, now)
  if (short.length >= SCAN_SHORT_MAX) {
    const wait = Math.ceil((READS_WINDOW_MS - (now - short[0]!)) / 60_000)
    throw createError({ statusCode: 429, statusMessage: `Too many scans — try again in ${wait} min, or type the numbers.` })
  }
  buckets.set(shortKey, [...short, now])
  buckets.set(dayKey, [...day, now])
  buckets.set(globalKey, [...all, now])
  gc(now)
}
