import { describe, expect, it } from 'vitest'
import {
  computeStatus,
  pickLastDone,
  sortByUrgency,
  type Condition,
  type ItemDef,
  type Reading,
  type Status
} from '../../../server/domain/maintenance-status'

const d = (s: string) => new Date(s)
const now = d('2026-11-08T12:00:00Z')
const r = (at: string, hoursTenths: number | null, km: number | null = 0, condition: Condition = 'normal'): Reading => ({
  at: d(at), hoursTenths, km, condition
})

describe('computeStatus', () => {
  it('oil overdue by hours', () => {
    const def: ItemDef = { everyHoursTenths: 200, conditionMultipliers: {} }
    const s = computeStatus(def, { at: d('2026-09-01T10:00:00Z'), hoursTenths: 1220 }, [
      r('2026-09-01T10:00:00Z', 1220), r('2026-10-20T10:00:00Z', 1425)
    ], now)
    expect(s.state).toBe('overdue')
    expect(s.sinceHoursTenths).toBe(205)
    expect(s.driver).toBe('hours')
    expect(s.remaining.hoursTenths).toBe(-5)
  })

  it('air filter with mud multiplier', () => {
    const def: ItemDef = { everyHoursTenths: 50, conditionMultipliers: { mud: 1.5 } }
    const last = { at: d('2026-10-01T10:00:00Z'), hoursTenths: 1385 }
    const mud = computeStatus(def, last, [
      r('2026-10-01T10:00:00Z', 1385), r('2026-10-20T10:00:00Z', 1425, 0, 'mud')
    ], now)
    expect(mud.effectiveHoursTenths).toBe(60)
    expect(mud.state).toBe('overdue')
    const normal = computeStatus(def, last, [
      r('2026-10-01T10:00:00Z', 1385), r('2026-10-20T10:00:00Z', 1425)
    ], now)
    expect(normal.effectiveHoursTenths).toBe(40)
    expect(normal.state).toBe('soon')
  })

  it('fork overdue by months', () => {
    const def: ItemDef = { everyHoursTenths: 500, everyMonths: 12, conditionMultipliers: {} }
    const s = computeStatus(def, { at: d('2025-10-04T12:00:00Z'), hoursTenths: 1400 }, [
      r('2025-10-04T12:00:00Z', 1400), r('2026-10-20T10:00:00Z', 1425)
    ], now)
    expect(s.state).toBe('overdue')
    expect(s.driver).toBe('months')
    expect(s.remaining.days).toBeLessThan(0)
  })

  it('chain soon by km, multipliers ignored', () => {
    const def: ItemDef = { everyKm: 1500, conditionMultipliers: { mud: 2 } }
    const s = computeStatus(def, { at: d('2026-06-01T10:00:00Z'), km: 3000 }, [
      r('2026-06-01T10:00:00Z', 100, 3000), r('2026-10-20T10:00:00Z', 200, 4280, 'mud')
    ], now)
    expect(s.state).toBe('soon')
    expect(s.sinceKm).toBe(1280)
    expect(s.remaining.km).toBe(220)
    expect(s.driver).toBe('km')
  })

  it('unknown without last', () => {
    const s = computeStatus({ everyHoursTenths: 200, everyMonths: 12, conditionMultipliers: {} }, null,
      [r('2026-10-20T10:00:00Z', 1425)], now)
    expect(s.state).toBe('unknown')
    expect(s.ratio).toBeNull()
    expect(s.driver).toBeNull()
  })

  it('unknown for hours-only item with zero readings', () => {
    const s = computeStatus({ everyHoursTenths: 200, conditionMultipliers: {} },
      { at: d('2026-09-01T10:00:00Z'), hoursTenths: 1220 }, [], now)
    expect(s.state).toBe('unknown')
  })

  it('uses reading at or before last.at as baseline when last has no hours', () => {
    const def: ItemDef = { everyHoursTenths: 200, conditionMultipliers: {} }
    const s = computeStatus(def, { at: d('2026-09-15T10:00:00Z') }, [
      r('2026-09-01T10:00:00Z', 1000), r('2026-09-20T10:00:00Z', 1100), r('2026-10-20T10:00:00Z', 1150)
    ], now)
    expect(s.sinceHoursTenths).toBe(150)
    expect(s.effectiveHoursTenths).toBe(150)
  })

  it('segment straddling the baseline counts only the part above it', () => {
    const def: ItemDef = { everyHoursTenths: 200, conditionMultipliers: { race: 2 } }
    const s = computeStatus(def, { at: d('2026-09-15T10:00:00Z'), hoursTenths: 1050 }, [
      r('2026-09-01T10:00:00Z', 1000), r('2026-09-20T10:00:00Z', 1100, 0, 'race')
    ], now)
    expect(s.effectiveHoursTenths).toBe(100)
  })

  it('months-only item works without readings', () => {
    const s = computeStatus({ everyMonths: 24, conditionMultipliers: {} },
      { at: d('2026-05-08T12:00:00Z') }, [], now)
    expect(s.state).toBe('ok')
    expect(s.sinceMonths).toBeGreaterThan(5.9)
    expect(s.remaining.days).toBe(Math.round(24 * 30.4375 - 184))
  })
})

describe('computeStatus with an unknown last-done date', () => {
  it('judges hours from the given meter but ignores months (no made-up date)', () => {
    const def: ItemDef = { everyHoursTenths: 200, everyMonths: 12, conditionMultipliers: {} }
    // Set up today with "last done at 139.0 h", date unknown; bike at 142.5 h.
    const s = computeStatus(def, { at: d('2026-11-08T00:00:00Z'), hoursTenths: 1390, dateUnknown: true }, [r('2026-11-08T09:00:00Z', 1425)], now)
    expect(s.sinceHoursTenths).toBe(35)
    expect(s.driver).toBe('hours')
    expect(s.sinceMonths).toBeNull()
    expect(s.remaining.days).toBeUndefined()
  })

  it('km-only with unknown date does not invent an hours baseline from that day\'s reading', () => {
    const def: ItemDef = { everyHoursTenths: 200, everyKm: 1500, conditionMultipliers: {} }
    const s = computeStatus(def, { at: d('2026-11-08T00:00:00Z'), km: 3000, dateUnknown: true }, [r('2026-11-08T09:00:00Z', 1425, 3812)], now)
    expect(s.sinceKm).toBe(812)
    expect(s.sinceHoursTenths).toBeNull()
    expect(s.driver).toBe('km')
  })

  it('only a months interval and an unknown date → unknown, never overdue', () => {
    const def: ItemDef = { everyMonths: 12, conditionMultipliers: {} }
    expect(computeStatus(def, { at: d('2026-11-08T00:00:00Z'), hoursTenths: 1390, dateUnknown: true }, [r('2026-11-08T09:00:00Z', 1425)], now).state).toBe('unknown')
  })
})

describe('services without meters (mark done / invoice with blank hours and km)', () => {
  const def: ItemDef = { everyHoursTenths: 200, conditionMultipliers: {} }

  it('a newer service with no meters wins: its hours come from the reading on or before its day', () => {
    const readings = [r('2026-08-11T10:00:00Z', 700), r('2026-11-08T09:00:00Z', 1000)]
    const last = pickLastDone([{ at: d('2026-08-11T00:00:00Z'), hoursTenths: 700 }, { at: d('2026-11-08T00:00:00Z') }], readings)
    expect(last).toMatchObject({ at: d('2026-11-08T00:00:00Z'), estHoursTenths: 1000 })
    expect(last!.hoursTenths).toBeUndefined() // never presented as a known meter
    expect(computeStatus(def, last, readings, now)).toMatchObject({ state: 'ok', sinceHoursTenths: 0 })
  })

  it('a garage invoice dated before the first reading still resets the item (first reading after is the bound)', () => {
    const readings = [r('2026-11-08T09:00:00Z', 1425)]
    const last = pickLastDone([{ at: d('2026-01-13T00:00:00Z'), hoursTenths: 400 }, { at: d('2026-11-02T00:00:00Z') }], readings)
    expect(last).toMatchObject({ at: d('2026-11-02T00:00:00Z'), estHoursTenths: 1425 })
    expect(computeStatus(def, last, readings, now).state).toBe('ok')
  })

  it('a backdated service without meters still never looks fresher (Review Focus 2)', () => {
    const readings = [r('2026-09-01T10:00:00Z', 1000), r('2026-10-01T10:00:00Z', 1300)]
    const last = pickLastDone([{ at: d('2026-10-01T00:00:00Z'), hoursTenths: 1300 }, { at: d('2026-09-02T00:00:00Z') }], readings)
    expect(last).toMatchObject({ at: d('2026-10-01T00:00:00Z'), hoursTenths: 1300 })
  })
})

describe('pickLastDone', () => {
  it('prefers the highest hours over creation order', () => {
    const r1 = pickLastDone([
      { at: d('2026-09-01T00:00:00Z'), hoursTenths: 1220 },
      { at: d('2026-08-01T00:00:00Z'), hoursTenths: 1380 }
    ])
    expect(r1?.hoursTenths).toBe(1380)
  })
  it('falls back to km then date; null when empty', () => {
    expect(pickLastDone([])).toBeNull()
    expect(pickLastDone([{ at: d('2026-01-01T00:00:00Z'), km: 10 }, { at: d('2026-02-01T00:00:00Z'), km: 20 }])?.km).toBe(20)
    expect(pickLastDone([{ at: d('2026-01-01T00:00:00Z') }, { at: d('2026-02-01T00:00:00Z') }])?.at).toEqual(d('2026-02-01T00:00:00Z'))
  })
})

describe('sortByUrgency', () => {
  const mk = (name: string, state: Status['state'], ratio: number | null) => ({
    name,
    status: { state, ratio } as Status
  })
  it('orders overdue, soon, ok, unknown', () => {
    const out = sortByUrgency([mk('ok', 'ok', 0.2), mk('unk', 'unknown', null), mk('over', 'overdue', 1.02), mk('soon', 'soon', 0.85)])
    expect(out.map(x => x.name)).toEqual(['over', 'soon', 'ok', 'unk'])
  })
})

describe('null meters', () => {
  it('km-only readings with a km interval', () => {
    const def: ItemDef = { everyKm: 1000, conditionMultipliers: {} }
    const s = computeStatus(def, { at: d('2026-10-01T10:00:00Z'), km: 1000 }, [
      r('2026-10-01T10:00:00Z', null, 1000), r('2026-11-01T10:00:00Z', null, 1800)
    ], now)
    expect(s.sinceKm).toBe(800)
    expect(s.state).toBe('soon')
    expect(s.sinceHoursTenths).toBeNull()
  })

  it('meter switched off then on: each unit uses only readings carrying it', () => {
    const def: ItemDef = { everyHoursTenths: 1000, everyKm: 5000, conditionMultipliers: {} }
    const readings = [
      r('2026-09-01T10:00:00Z', 100, 1000),
      r('2026-10-01T10:00:00Z', null, 1500),
      r('2026-11-01T10:00:00Z', 160, null)
    ]
    const s = computeStatus(def, { at: d('2026-09-01T10:00:00Z') }, readings, now)
    expect(s.sinceHoursTenths).toBe(60)
    expect(s.sinceKm).toBe(500)
  })

  it('pickLastDone estimate skips readings whose unit is null', () => {
    const readings = [r('2026-10-01T10:00:00Z', 300, 900), r('2026-10-20T10:00:00Z', null, 1200)]
    const last = pickLastDone([{ at: d('2026-10-25T00:00:00Z') }], readings)
    expect(last?.estHoursTenths).toBe(300)
    expect(last?.estKm).toBe(1200)
  })
})
