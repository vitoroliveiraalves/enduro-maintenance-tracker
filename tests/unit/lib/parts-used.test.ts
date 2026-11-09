import { describe, expect, it } from 'vitest'
import { mergeUseLines, partsLine } from '../../../app/lib/parts-used'

describe('mergeUseLines', () => {
  it('sums lines for the same part into one with a unique clientId', () => {
    const out = mergeUseLines([
      { clientId: 'a', partId: 'p1', qtyHundredths: 100, partName: 'Filter' },
      { clientId: 'b', partId: 'p2', qtyHundredths: 50, partName: 'Oil' },
      { clientId: 'c', partId: 'p1', qtyHundredths: 200, partName: 'Filter' },
    ])
    expect(out).toEqual([
      { clientId: 'a', partId: 'p1', qtyHundredths: 300, partName: 'Filter' },
      { clientId: 'b', partId: 'p2', qtyHundredths: 50, partName: 'Oil' },
    ])
    expect(new Set(out.map((l) => l.partId)).size).toBe(out.length)
    expect(new Set(out.map((l) => l.clientId)).size).toBe(out.length)
  })
  it('does not mutate its input', () => {
    const input = [{ clientId: 'a', partId: 'p1', qtyHundredths: 100, partName: 'F' }, { clientId: 'b', partId: 'p1', qtyHundredths: 100, partName: 'F' }]
    mergeUseLines(input)
    expect(input[0]!.qtyHundredths).toBe(100)
  })
})

describe('partsLine', () => {
  it('is empty without parts', () => {
    expect(partsLine([])).toBe('')
    expect(partsLine(undefined)).toBe('')
  })
  it('sorts by name and shows quantity and unit', () => {
    expect(partsLine([
      { name: 'Motorex 10W-50', qtyHundredths: 100, unit: 'L' },
      { name: 'Oil filter', qtyHundredths: 100, unit: 'pcs' },
    ])).toBe('Parts: 1 L Motorex 10W-50, Oil filter')
    expect(partsLine([{ name: 'Plug', qtyHundredths: 200, unit: 'pcs' }])).toBe('Parts: 2 Plug')
  })
})
