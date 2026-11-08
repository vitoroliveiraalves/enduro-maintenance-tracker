import { createError } from 'h3'

/**
 * Shared input validators. Anything a client sends goes through these, so bad
 * input is a 400 (or a 404 for ids in the path) and never reaches Postgres.
 */
export const bad = (msg: string) => createError({ statusCode: 400, statusMessage: msg })

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** Years Postgres and the UI both handle sanely; 0000-01-01 or 275760 are typos, not rides. */
export const MIN_YEAR = 1900
export const MAX_YEAR = 2100

const inYears = (d: Date) => !Number.isNaN(d.getTime()) && d.getUTCFullYear() >= MIN_YEAR && d.getUTCFullYear() <= MAX_YEAR

/** "YYYY-MM-DD" that really exists (no 2026-13-45, no 2027-02-29), year 1900–2100. */
export function isDay(s: unknown): s is string {
  if (typeof s !== 'string' || !DAY_RE.test(s)) return false
  const d = new Date(`${s}T00:00:00Z`)
  return inYears(d) && d.toISOString().slice(0, 10) === s
}

/** A parseable date-time, year 1900–2100. */
export function isTimestamp(s: unknown): s is string {
  return typeof s === 'string' && s.length <= 40 && inYears(new Date(s))
}

export const isUuid = (s: unknown): s is string => typeof s === 'string' && UUID_RE.test(s)

export const isInt = (n: unknown, min: number, max: number): n is number =>
  typeof n === 'number' && Number.isInteger(n) && n >= min && n <= max

/** Throwing forms: 400 with "Invalid <field>". */
export function day(v: unknown, label = 'date'): string {
  if (!isDay(v)) throw bad(`Invalid ${label}`)
  return v
}

export function timestamp(v: unknown, label = 'date'): Date {
  if (!isTimestamp(v)) throw bad(`Invalid ${label}`)
  return new Date(v)
}

export function uuid(v: unknown, field = 'clientId'): string {
  if (!isUuid(v)) throw bad(`Invalid ${field}`)
  return v
}

export function int(v: unknown, field: string, min = 0, max = 10_000_000): number {
  if (!isInt(v, min, max)) throw bad(`Invalid ${field}`)
  return v
}
