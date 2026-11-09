import { describe, expect, it } from 'vitest'
import { day, int, isDay, isInt, isTimestamp, isUuid, timestamp, uuid } from '../../../server/utils/validate'

const status = (fn: () => unknown) => {
  try {
    fn()
    return 200
  } catch (e) {
    return (e as { statusCode?: number }).statusCode
  }
}

describe('validate', () => {
  it('day: real calendar days in 1900–2100 only', () => {
    expect(isDay('2026-11-08')).toBe(true)
    expect(isDay('2028-02-29')).toBe(true)
    expect(isDay('1900-01-01')).toBe(true)
    expect(isDay('2100-12-31')).toBe(true)
    for (const bad of ['2026-13-45', '2027-02-29', '0000-01-01', '1899-12-31', '2101-01-01', '2026-1-1', '2026-11-08T10:00:00Z', '', null, 20261108]) {
      expect(isDay(bad), String(bad)).toBe(false)
    }
    expect(day('2026-11-08')).toBe('2026-11-08')
    expect(status(() => day('2026-13-45'))).toBe(400)
  })

  it('timestamp: parseable, same year bounds', () => {
    expect(isTimestamp('2026-11-08T10:00:00.000Z')).toBe(true)
    expect(isTimestamp('2026-03-01T00:30:00+02:00')).toBe(true)
    expect(timestamp('2026-11-08T10:00:00Z').toISOString()).toBe('2026-11-08T10:00:00.000Z')
    for (const bad of ['0000-01-01T00:00:00Z', '+275760-09-13T00:00:00Z', 'yesterday', '2026-13-45T00:00:00Z', '2026-02-30T10:00:00Z', '2026-04-31', 123]) {
      expect(isTimestamp(bad), String(bad)).toBe(false)
    }
    expect(status(() => timestamp('0000-01-01'))).toBe(400)
  })

  it('uuid and int', () => {
    const id = crypto.randomUUID()
    expect(isUuid(id)).toBe(true)
    expect(uuid(id)).toBe(id)
    for (const bad of ['nope', `${id}x`, 123, null]) expect(isUuid(bad)).toBe(false)
    expect(status(() => uuid('nope'))).toBe(400)
    expect(isInt(5, 1, 5)).toBe(true)
    for (const bad of [0, 6, 1.5, '3', Number.NaN, 99999999999]) expect(isInt(bad, 1, 5)).toBe(false)
    expect(int(7, 'n')).toBe(7)
    expect(status(() => int(-1, 'n'))).toBe(400)
  })
})
