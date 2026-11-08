import { describe, expect, it } from 'vitest'
import { stateText } from '~/lib/item-state'

const row = (state: string, driver: string | null, remaining: object) =>
  ({ status: { state, driver, remaining } }) as never

describe('stateText', () => {
  it('overdue by hours, km and months', () => {
    expect(stateText(row('overdue', 'hours', { hoursTenths: -55 }))).toBe('overdue 5.5h')
    expect(stateText(row('overdue', 'km', { km: -120 }))).toMatch(/^overdue 120.km$/)
    expect(stateText(row('overdue', 'months', { days: -61 }))).toBe('overdue 2 mo')
  })
  it('time left and unknown', () => {
    expect(stateText(row('soon', 'hours', { hoursTenths: 10 }))).toBe('1.0h left')
    expect(stateText(row('ok', 'months', { days: 12 }))).toBe('12 d left')
    expect(stateText(row('unknown', null, {}))).toBe('Unknown — set last done')
  })
})
