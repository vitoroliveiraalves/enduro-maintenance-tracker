import type { Reading } from './maintenance-status'

type Meters = { hoursTenths: number; km: number }

export const BIG_JUMP_HOURS_TENTHS = 500
export const BIG_JUMP_KM = 1500

export type ReadingCheck =
  | { ok: true; warn?: 'big-jump' }
  | { ok: false; error: 'hours-decreased' | 'km-decreased' }

/** New reading vs the reading just before it in time: never lower, ask when the jump is huge. */
export function validateReading(prev: Reading | null, next: Meters): ReadingCheck {
  if (!prev) return { ok: true }
  if (next.hoursTenths < prev.hoursTenths) return { ok: false, error: 'hours-decreased' }
  if (next.km < prev.km) return { ok: false, error: 'km-decreased' }
  if (next.hoursTenths - prev.hoursTenths > BIG_JUMP_HOURS_TENTHS || next.km - prev.km > BIG_JUMP_KM) {
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
  if (next.hoursTenths > later.hoursTenths) return { ok: false, error: 'hours-exceed-later' }
  if (next.km > later.km) return { ok: false, error: 'km-exceed-later' }
  return { ok: true }
}
