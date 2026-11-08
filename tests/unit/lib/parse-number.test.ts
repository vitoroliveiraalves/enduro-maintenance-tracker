import { describe, expect, it } from 'vitest'
import { parseCents, parseDecimal } from '~/lib/parse-number'

describe('parseDecimal', () => {
  it('accepts a decimal comma', () => expect(parseDecimal('142,5')).toBe(142.5))
  it('accepts a decimal point', () => expect(parseDecimal('142.5')).toBe(142.5))
  it('ignores surrounding and thousands whitespace', () => expect(parseDecimal(' 3 812 ')).toBe(3812))
  it('returns null for text', () => expect(parseDecimal('abc')).toBeNull())
  it('returns null for empty input', () => expect(parseDecimal('')).toBeNull())
})

describe('parseCents', () => {
  it('turns comma and dot amounts into cents', () => {
    expect(parseCents('24,90')).toBe(2490)
    expect(parseCents('41.6')).toBe(4160)
    expect(parseCents('0,29')).toBe(29)
    expect(parseCents('1 234,56')).toBe(123456)
  })
  it('rejects zero, negative, too large and text', () => {
    for (const v of ['0', '-5', '100000,01', 'abc', '', '0,001']) expect(parseCents(v), v).toBeNull()
  })
})
