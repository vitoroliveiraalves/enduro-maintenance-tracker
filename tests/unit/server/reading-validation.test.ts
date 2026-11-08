import { describe, expect, it } from 'vitest'
import { validateBeforeLater, validateReading } from '../../../server/domain/reading-validation'

const prev = { at: new Date('2026-10-01'), hoursTenths: 1440, km: 3812, condition: 'normal' as const }

describe('validateReading', () => {
  it('accepts anything when there is no previous reading', () => {
    expect(validateReading(null, { hoursTenths: 99_999, km: 999_999 })).toEqual({ ok: true })
  })
  it('rejects lower hours and lower km separately', () => {
    expect(validateReading(prev, { hoursTenths: 1400, km: 3812 })).toEqual({ ok: false, error: 'hours-decreased' })
    expect(validateReading(prev, { hoursTenths: 1440, km: 3000 })).toEqual({ ok: false, error: 'km-decreased' })
  })
  it('accepts equal values', () => {
    expect(validateReading(prev, { hoursTenths: 1440, km: 3812 })).toEqual({ ok: true })
  })
  it('warns on a jump of more than 500 tenths or 1500 km, not at the limit', () => {
    expect(validateReading(prev, { hoursTenths: 1941, km: 3812 })).toEqual({ ok: true, warn: 'big-jump' })
    expect(validateReading(prev, { hoursTenths: 1440, km: 5313 })).toEqual({ ok: true, warn: 'big-jump' })
    expect(validateReading(prev, { hoursTenths: 1940, km: 5312 })).toEqual({ ok: true })
  })
  it('typo 1440 for 144.0 h is a big jump', () => {
    expect(validateReading({ ...prev, hoursTenths: 1440 }, { hoursTenths: 14_400, km: 3812 })).toEqual({ ok: true, warn: 'big-jump' })
  })
})

describe('validateBeforeLater', () => {
  const later = { ...prev, at: new Date('2026-11-01') }
  it('allows values up to the later reading', () => {
    expect(validateBeforeLater(null, { hoursTenths: 5000, km: 1 })).toEqual({ ok: true })
    expect(validateBeforeLater(later, { hoursTenths: 1440, km: 3812 })).toEqual({ ok: true })
  })
  it('rejects values above it', () => {
    expect(validateBeforeLater(later, { hoursTenths: 1441, km: 100 })).toEqual({ ok: false, error: 'hours-exceed-later' })
    expect(validateBeforeLater(later, { hoursTenths: 100, km: 3813 })).toEqual({ ok: false, error: 'km-exceed-later' })
  })
})
