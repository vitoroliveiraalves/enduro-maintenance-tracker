import { describe, expect, it } from 'vitest'
import { daysUntil, dueChips, dueText } from '~/lib/reminders'
import { isIos, urlBase64ToUint8Array } from '~/lib/platform'

const today = new Date(2026, 10, 8, 23, 30) // 8 Nov 2026, late evening local time

describe('daysUntil', () => {
  it('counts calendar days from the local today', () => {
    expect(daysUntil('2026-11-08', today)).toBe(0)
    expect(daysUntil('2026-11-20', today)).toBe(12)
    expect(daysUntil('2026-11-01', today)).toBe(-7)
    expect(daysUntil('2027-03-28', today)).toBe(140) // across the DST change
  })
})

describe('dueText', () => {
  it('reads naturally', () => {
    expect(dueText(12)).toBe('in 12 days')
    expect(dueText(1)).toBe('tomorrow')
    expect(dueText(0)).toBe('today')
    expect(dueText(-3)).toBe('overdue')
  })
})

describe('dueChips', () => {
  it('keeps reminders due within 30 days, amber upcoming and red overdue', () => {
    const chips = dueChips(
      [
        { id: 'a', title: 'IUC', dueOn: '2026-11-20' },
        { id: 'b', title: 'Insurance', dueOn: '2026-11-01' },
        { id: 'c', title: 'Inspection', dueOn: '2026-12-08' },
        { id: 'd', title: 'Licence', dueOn: '2026-12-09' },
      ],
      today,
    )
    expect(chips).toEqual([
      { id: 'a', text: 'IUC · in 12 days', tone: 'warn' },
      { id: 'b', text: 'Insurance · overdue', tone: 'danger' },
      { id: 'c', text: 'Inspection · in 30 days', tone: 'warn' },
    ])
  })
})

describe('isIos', () => {
  it('spots iPhone and iPadOS (desktop UA with touch), not Android', () => {
    expect(isIos('Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15', 5)).toBe(true)
    expect(isIos('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15', 5)).toBe(true)
    expect(isIos('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15', 0)).toBe(false)
    expect(isIos('Mozilla/5.0 (Linux; Android 14; Pixel 7) Chrome/120', 5)).toBe(false)
  })
})

describe('urlBase64ToUint8Array', () => {
  it('decodes url-safe base64 without padding', () => {
    expect([...urlBase64ToUint8Array('AQID_-8')]).toEqual([1, 2, 3, 255, 239])
  })
})
