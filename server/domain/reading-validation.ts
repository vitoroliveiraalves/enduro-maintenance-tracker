import type { Reading } from './maintenance-status'

type Meters = { hoursTenths: number | null; km: number | null }

/** Both sides present, else nothing to compare. */
const both = (a: number | null, b: number | null): [number, number] | null => (a !== null && b !== null ? [a, b] : null)

export const BIG_JUMP_HOURS_TENTHS = 500
export const BIG_JUMP_KM = 1500

export type ReadingCheck =
  | { ok: true; warn?: 'big-jump' }
  | { ok: false; error: 'hours-decreased' | 'km-decreased' }

/** New reading vs the reading just before it in time: never lower, ask when the jump is huge. */
export function validateReading(prev: Reading | null, next: Meters): ReadingCheck {
  if (!prev) return { ok: true }
  const h = both(next.hoursTenths, prev.hoursTenths)
  const k = both(next.km, prev.km)
  if (h && h[0] < h[1]) return { ok: false, error: 'hours-decreased' }
  if (k && k[0] < k[1]) return { ok: false, error: 'km-decreased' }
  if ((h && h[0] - h[1] > BIG_JUMP_HOURS_TENTHS) || (k && k[0] - k[1] > BIG_JUMP_KM)) {
    return { ok: true, warn: 'big-jump' }
  }
  return { ok: true }
}

/** A backdated reading must not exceed the first reading after it. */
export function validateBeforeLater(
  later: Reading | null,
  next: Meters,
): { ok: true } | { ok: false; error: 'hours-exceed-later' | 'km-exceed-later' } {
  if (!later) return { ok: true }
  const h = both(next.hoursTenths, later.hoursTenths)
  const k = both(next.km, later.km)
  if (h && h[0] > h[1]) return { ok: false, error: 'hours-exceed-later' }
  if (k && k[0] > k[1]) return { ok: false, error: 'km-exceed-later' }
  return { ok: true }
}
