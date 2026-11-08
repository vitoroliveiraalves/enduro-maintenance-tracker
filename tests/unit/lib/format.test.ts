import { describe, expect, it } from 'vitest'
import { formatDate, formatDayMonth, formatWeekdayDay, formatHours, formatHoursLong, formatKm, formatMoney } from '~/lib/format'

describe('format', () => {
  it('formats money from cents', () => {
    expect(formatMoney(123456)).toBe('1.234,56 €')
    expect(formatMoney(-990)).toBe('-9,90 €')
    expect(formatMoney(5)).toBe('0,05 €')
  })
  it('formats hours from tenths', () => expect(formatHours(1425)).toBe('142.5 h'))
  it('formats km with thin-space thousands', () => {
    expect(formatKm(3812)).toBe('3 812 km')
    expect(formatKm(950)).toBe('950 km')
  })
  it('formats dates', () => expect(formatDate('2026-10-06')).toBe('6 Oct 2026'))
})

describe('formatHoursLong', () => {
  it('groups thousands with a thin space', () => {
    expect(formatHoursLong(12_825)).toBe(`1${String.fromCharCode(0x202f)}282.5 h`)
    expect(formatHoursLong(1440)).toBe('144.0 h')
  })
})
describe('short dates', () => {
  it('day + month', () => expect(formatDayMonth('2026-09-12T00:00:00.000Z')).toBe('12 Sep'))
  it('weekday, day, month', () => expect(formatWeekdayDay('2026-11-02T10:00:00.000Z')).toBe('Mon, 2 Nov'))
})
