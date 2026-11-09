import { describe, expect, it } from 'vitest'
import { computeAuto, isVisibleManual } from '../../../server/utils/shopping'
import type { BikeItems } from '../../../server/utils/shopping'
import type { PartRow } from '../../../server/utils/parts'

const part = (over: Partial<PartRow> = {}): PartRow => ({
  id: 'p1', name: 'Oil', unit: 'pcs', qtyHundredths: 0, minHundredths: null, notes: null, bikeId: null, bikeName: null, itemIds: [], ...over,
})
const bikeWith = (...items: Array<[string, 'overdue' | 'soon' | 'ok' | 'unknown']>): BikeItems[] => [
  { bikeId: 'b1', bikeName: 'KTM 300', items: items.map(([id, state]) => ({ id, name: `Item ${id}`, state })) },
]

describe('computeAuto', () => {
  it('lists an out-of-stock part linked to an overdue item', () => {
    expect(computeAuto([part({ itemIds: ['i1'] })], bikeWith(['i1', 'overdue']))).toEqual([
      { key: 'due:p1', partId: 'p1', partName: 'Oil', unit: 'pcs', bikeId: 'b1', bikeName: 'KTM 300', reason: 'due', detail: 'Item i1 on KTM 300 — overdue' },
    ])
  })
  it('words a soon item as due soon', () => {
    expect(computeAuto([part({ itemIds: ['i1'] })], bikeWith(['i1', 'soon']))[0]!.detail).toBe('Item i1 on KTM 300 — due soon')
  })
  it('skips a due part that is in stock', () => {
    expect(computeAuto([part({ qtyHundredths: 100, itemIds: ['i1'] })], bikeWith(['i1', 'overdue']))).toEqual([])
  })
  it('skips an out-of-stock part whose items are ok or unknown', () => {
    expect(computeAuto([part({ itemIds: ['i1', 'i2'] })], bikeWith(['i1', 'ok'], ['i2', 'unknown']))).toEqual([])
  })
  it('lists a part under its minimum', () => {
    expect(computeAuto([part({ qtyHundredths: 100, minHundredths: 200, bikeId: 'b1', bikeName: 'KTM 300' })], [])).toEqual([
      { key: 'min:p1', partId: 'p1', partName: 'Oil', unit: 'pcs', bikeId: 'b1', bikeName: 'KTM 300', reason: 'min', detail: 'keep 2, have 1' },
    ])
  })
  it('does not list a part at or above its minimum', () => {
    expect(computeAuto([part({ qtyHundredths: 200, minHundredths: 200 })], [])).toEqual([])
  })
  it('formats fractions and units', () => {
    expect(computeAuto([part({ unit: 'L', qtyHundredths: 150, minHundredths: 200 })], [])[0]!.detail).toBe('keep 2 L, have 1.5 L')
  })
  it('lists a part matching both once, as due', () => {
    const out = computeAuto([part({ minHundredths: 200, itemIds: ['i1'] })], bikeWith(['i1', 'soon']))
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ key: 'due:p1', reason: 'due' })
  })
  it('names the most urgent item when several are due', () => {
    const out = computeAuto([part({ itemIds: ['i1', 'i2'] })], bikeWith(['i1', 'soon'], ['i2', 'overdue']))
    expect(out).toHaveLength(1)
    expect(out[0]!.detail).toBe('Item i2 on KTM 300 — overdue')
  })
  it('ignores links to items of archived bikes (not in the map)', () => {
    expect(computeAuto([part({ itemIds: ['gone'] })], bikeWith())).toEqual([])
  })
})

describe('isVisibleManual', () => {
  const now = new Date('2026-11-09T12:00:00Z')
  it('shows open entries and recently done ones', () => {
    expect(isVisibleManual(null, now)).toBe(true)
    expect(isVisibleManual(new Date('2026-11-03T12:00:00Z'), now)).toBe(true)
  })
  it('hides entries done more than 7 days ago', () => {
    expect(isVisibleManual(new Date('2026-11-02T11:59:00Z'), now)).toBe(false)
  })
})
