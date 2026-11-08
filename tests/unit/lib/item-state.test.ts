import { describe, expect, it } from 'vitest'
import { stateText, subline } from '~/lib/item-state'

const row = (state: string, driver: string | null, remaining: object, extra: Record<string, unknown> = {}) =>
  ({ status: { state, driver, remaining, ...extra } }) as never

describe('stateText (right-hand text, driver unit)', () => {
  it('hours', () => {
    expect(stateText(row('overdue', 'hours', { hoursTenths: -5 }))).toBe('overdue 0.5h')
    expect(stateText(row('soon', 'hours', { hoursTenths: 10 }))).toBe('1h left')
    expect(stateText(row('ok', 'hours', { hoursTenths: 385 }))).toBe('38.5h left')
  })
  it('km', () => {
    expect(stateText(row('soon', 'km', { km: 220 }))).toBe('220 km left')
    expect(stateText(row('overdue', 'km', { km: -30 }))).toBe('overdue 30 km')
    expect(stateText(row('ok', 'km', { km: 1200 }))).toBe(`1${String.fromCharCode(0x202f)}200 km left`)
  })
  it('months switch to days under 60 days', () => {
    expect(stateText(row('ok', 'months', { days: 91 }))).toBe('3 months left')
    expect(stateText(row('ok', 'months', { days: 60 }))).toBe('2 months left')
    expect(stateText(row('soon', 'months', { days: 59 }))).toBe('59 days left')
    expect(stateText(row('soon', 'months', { days: 12 }))).toBe('12 days left')
    expect(stateText(row('overdue', 'months', { days: -61 }))).toBe('overdue 2 months')
    expect(stateText(row('overdue', 'months', { days: -5 }))).toBe('overdue 5 days')
  })
  it('unknown', () => expect(stateText(row('unknown', null, {}))).toBe('Set last done'))
})

describe('subline', () => {
  const last = { at: '2026-09-12T00:00:00.000Z', by: 'diy' as const }
  it('hours driver with date', () => {
    const r = { def: { everyHoursTenths: 200 }, last, status: { state: 'overdue', driver: 'hours', effectiveHoursTenths: 205 } }
    expect(subline(r as never)).toBe('20.5h since change (every 20h) · 12 Sep')
  })
  it('appends garage and lists other intervals', () => {
    const r = {
      def: { everyHoursTenths: 500, everyMonths: 12 },
      last: { ...last, by: 'garage' as const, garageName: 'Moto Garage' },
      status: { state: 'ok', driver: 'hours', effectiveHoursTenths: 120 },
    }
    expect(subline(r as never)).toBe('12h since change (every 50h or 12 months) · 12 Sep · garage')
  })
  it('km driver', () => {
    const T = String.fromCharCode(0x202f)
    const r = { def: { everyKm: 1500 }, last: { at: '2026-09-12T00:00:00.000Z', by: 'diy' }, status: { state: 'soon', driver: 'km', sinceKm: 1280 } }
    expect(subline(r as never)).toBe(`1${T}280 km since change (every 1${T}500 km) · 12 Sep`)
  })
  it('unknown', () => {
    const r = { def: { everyHoursTenths: 200 }, last: null, status: { state: 'unknown', driver: null } }
    expect(subline(r as never)).toBe('Not logged yet (every 20h)')
  })
})
