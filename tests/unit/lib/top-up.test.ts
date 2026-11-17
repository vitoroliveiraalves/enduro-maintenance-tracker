import { describe, expect, it } from 'vitest'
import { computeTopUpSummary, formatVolumeMl } from '../../../app/lib/top-up'

describe('top-up helpers', () => {
  it('formats ml and L concisely', () => {
    expect(formatVolumeMl(500)).toBe('500 ml')
    expect(formatVolumeMl(1000)).toBe('1.0 L')
    expect(formatVolumeMl(1250)).toBe('1.25 L')
    expect(formatVolumeMl(1500)).toBe('1.5 L')
  })

  it('computes totals and consumption rate since the last full service', () => {
    const services = [
      { topUp: true, topUpMl: 500, km: 12000, hoursTenths: null },
      { topUp: true, topUpMl: 500, km: 11000, hoursTenths: null },
      { topUp: false, topUpMl: null, km: 10000, hoursTenths: null },
      // Older top-up before the last full service must be ignored
      { topUp: true, topUpMl: 750, km: 8000, hoursTenths: null },
    ]
    const summary = computeTopUpSummary(services, { km: 12000, hoursTenths: null })
    expect(summary).toEqual({
      count: 2,
      totalMl: 1000,
      litersPer1000Km: 0.5,
      mlPer10Hours: null,
    })
  })

  it('computes km rate from two top-ups when no full service exists yet', () => {
    const services = [
      { topUp: true, topUpMl: 400, km: 5800, hoursTenths: null },
      { topUp: true, topUpMl: 300, km: 5000, hoursTenths: null },
    ]
    const summary = computeTopUpSummary(services, { km: 5800, hoursTenths: null })
    expect(summary).toEqual({
      count: 2,
      totalMl: 700,
      litersPer1000Km: 0.5,
      mlPer10Hours: null,
    })
  })

  it('computes ml per 10 hours for hour-counted engines', () => {
    const services = [
      { topUp: true, topUpMl: 200, km: null, hoursTenths: 1400 },
      { topUp: false, topUpMl: null, km: null, hoursTenths: 1200 },
    ]
    const summary = computeTopUpSummary(services, { km: null, hoursTenths: 1400 })
    expect(summary).toEqual({
      count: 1,
      totalMl: 200,
      litersPer1000Km: null,
      mlPer10Hours: 100,
    })
  })

  it('returns null when there are no top-ups since the last full service', () => {
    expect(
      computeTopUpSummary([{ topUp: false, topUpMl: null, km: 10000, hoursTenths: null }], { km: 11000, hoursTenths: null }),
    ).toBeNull()
  })
})
