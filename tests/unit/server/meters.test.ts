import { describe, expect, it } from 'vitest'
import { countedDef, countsHours, countsKm, isBikeMeters, keepCounted } from '../../../shared/utils/meters'

describe('meters helper', () => {
  it('says which units a bike counts', () => {
    expect(countsHours('km')).toBe(false)
    expect(countsKm('hours')).toBe(false)
    expect(countsHours('hours_km') && countsKm('hours_km')).toBe(true)
    expect(countsHours('hours')).toBe(true)
    expect(countsKm('km')).toBe(true)
  })
  it('keepCounted nulls uncounted units and defaults missing ones to null', () => {
    expect(keepCounted('km', { hoursTenths: 50, km: 10 })).toEqual({ hoursTenths: null, km: 10 })
    expect(keepCounted('hours', { hoursTenths: 50, km: 10 })).toEqual({ hoursTenths: 50, km: null })
    expect(keepCounted('hours_km', {})).toEqual({ hoursTenths: null, km: null })
  })
  it('countedDef drops only the uncounted interval', () => {
    const def = { everyHoursTenths: 150, everyKm: 6000, everyMonths: 12 }
    expect(countedDef('km', def)).toEqual({ everyKm: 6000, everyMonths: 12 })
    expect(countedDef('hours', def)).toEqual({ everyHoursTenths: 150, everyMonths: 12 })
    expect(countedDef('hours_km', def)).toEqual(def)
  })
  it('isBikeMeters guards the enum', () => {
    expect(isBikeMeters('street')).toBe(false)
    expect(isBikeMeters('km')).toBe(true)
  })
})
