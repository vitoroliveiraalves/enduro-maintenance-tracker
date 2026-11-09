import { describe, expect, it } from 'vitest'
import { isoWeek, notificationsDue, type NotifyInput } from '../../../server/domain/notify-rules'
import type { Status } from '../../../server/domain/maintenance-status'

const status = (state: Status['state'], ratio: number | null = null): Status => ({
  state,
  ratio,
  driver: ratio === null ? null : 'hours',
  sinceHoursTenths: null,
  effectiveHoursTenths: null,
  sinceKm: null,
  sinceMonths: null,
  remaining: {},
})

const item = (state: Status['state'], over: Partial<NotifyInput['items'][number]> = {}) => ({
  bikeId: 'b1',
  bikeName: 'KTM 300',
  itemId: 'i1',
  itemName: 'Gearbox oil',
  lastServiceId: 's1',
  status: status(state, state === 'overdue' ? 1.1 : state === 'soon' ? 0.85 : state === 'ok' ? 0.2 : null),
  ...over,
})

// Wednesday 11 Nov 2026, 14:00 Lisbon (UTC+0 in November)
const WED = new Date('2026-11-11T14:00:00Z')
const base = (over: Partial<NotifyInput> = {}): NotifyInput => ({
  now: WED,
  items: [],
  reminders: [],
  lastReadingAt: new Date('2026-11-10T10:00:00Z'),
  timezone: 'Europe/Lisbon',
  ...over,
})
const keys = (input: NotifyInput) => notificationsDue(input).map((n) => n.key)

describe('notificationsDue — items', () => {
  it('an item that crossed to soon gives exactly one notification', () => {
    const out = notificationsDue(base({ items: [item('soon')] }))
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ key: 'item:i1:soon', url: '/bikes/b1/items/i1' })
    expect(out[0]!.title).toContain('Gearbox oil')
    expect(out[0]!.body).toContain('KTM 300')
  })

  it('overdue keys carry the last service id, so a new overdue after a service notifies again', () => {
    expect(keys(base({ items: [item('overdue')] }))).toEqual(['item:i1:overdue:s1'])
    expect(keys(base({ items: [item('overdue', { lastServiceId: 's2' })] }))).toEqual(['item:i1:overdue:s2'])
  })

  it('ok and unknown items never notify', () => {
    expect(keys(base({ items: [item('ok'), item('unknown', { itemId: 'i2' })] }))).toEqual([])
  })
})

describe('notificationsDue — reminders', () => {
  const rem = (dueOn: string) => ({ id: 'r1', title: 'IUC', dueOn: new Date(`${dueOn}T00:00:00Z`) })

  it('7 days out → the 7d reminder', () => {
    const out = notificationsDue(base({ reminders: [rem('2026-11-18')] }))
    expect(out.map((n) => n.key)).toEqual(['reminder:r1:7d'])
    expect(out[0]!.body).toContain('in 7 days')
    expect(out[0]!.url).toBe('/settings#reminders')
  })

  it('8 days out → nothing yet', () => {
    expect(keys(base({ reminders: [rem('2026-11-19')] }))).toEqual([])
  })

  it('on the day → the 0d reminder', () => {
    const out = notificationsDue(base({ reminders: [rem('2026-11-11')] }))
    expect(out.map((n) => n.key)).toEqual(['reminder:r1:0d'])
    expect(out[0]!.body).toContain('today')
  })

  it('past due → still the 0d reminder (once, deduped by key)', () => {
    expect(keys(base({ reminders: [rem('2026-11-02')] }))).toEqual(['reminder:r1:0d'])
  })

  it('the day boundary follows the subscription timezone', () => {
    // 23:30 UTC on 10 Nov is already 11 Nov in Tokyo
    const now = new Date('2026-11-10T23:30:00Z')
    expect(keys(base({ now, reminders: [rem('2026-11-11')], timezone: 'Asia/Tokyo' }))).toEqual(['reminder:r1:0d'])
    expect(keys(base({ now, reminders: [rem('2026-11-11')], timezone: 'Europe/Lisbon' }))).toEqual(['reminder:r1:7d'])
  })
})

describe('notificationsDue — weekly nudge', () => {
  const MON_9 = new Date('2026-11-16T09:00:00Z') // Monday 09:00 Lisbon
  const staleReading = new Date('2026-11-12T18:00:00Z') // Thursday before the weekend
  const fridayReading = new Date('2026-11-13T08:00:00Z') // Friday

  it('Monday 09:00 local with a reading older than the previous Friday → nudge keyed by ISO week', () => {
    const out = notificationsDue(base({ now: MON_9, lastReadingAt: staleReading }))
    expect(out.map((n) => n.key)).toEqual(['nudge:2026-W47'])
    expect(out[0]!.url).toBe('/')
  })

  it('nudge text names only the meters the rider\'s bikes count', () => {
    const body = (meters?: { hours: boolean; km: boolean }) => notificationsDue(base({ now: MON_9, lastReadingAt: staleReading, meters }))[0]!.body
    expect(body()).toBe('Update your hours and km so maintenance stays on track.')
    expect(body({ hours: false, km: true })).toBe('Update your km so maintenance stays on track.')
    expect(body({ hours: true, km: false })).toBe('Update your hours so maintenance stays on track.')
  })

  it('no nudge when a reading exists from Friday on', () => {
    expect(keys(base({ now: MON_9, lastReadingAt: fridayReading }))).toEqual([])
  })

  it('no nudge on other days, or before 09:00 on Monday', () => {
    expect(keys(base({ now: new Date('2026-11-17T09:00:00Z'), lastReadingAt: staleReading }))).toEqual([])
    expect(keys(base({ now: new Date('2026-11-16T08:59:00Z'), lastReadingAt: staleReading }))).toEqual([])
  })

  it('no nudge for a rider with no readings at all (no bikes yet)', () => {
    expect(keys(base({ now: MON_9, lastReadingAt: null }))).toEqual([])
  })

  it('Monday 09:00 is computed in the subscription timezone', () => {
    // 09:00 Monday in New York is 14:00 UTC; at 09:00 UTC it is still 04:00 there
    expect(keys(base({ now: MON_9, lastReadingAt: staleReading, timezone: 'America/New_York' }))).toEqual([])
    expect(keys(base({ now: new Date('2026-11-16T14:00:00Z'), lastReadingAt: staleReading, timezone: 'America/New_York' }))).toEqual(['nudge:2026-W47'])
  })

  it('an unknown timezone falls back to Europe/Lisbon', () => {
    expect(keys(base({ now: MON_9, lastReadingAt: staleReading, timezone: 'Mars/Olympus' }))).toEqual(['nudge:2026-W47'])
  })
})

describe('isoWeek', () => {
  it('handles year boundaries', () => {
    expect(isoWeek('2026-01-01')).toBe('2026-W01')
    expect(isoWeek('2027-01-01')).toBe('2026-W53')
    expect(isoWeek('2024-12-30')).toBe('2025-W01')
  })
})
