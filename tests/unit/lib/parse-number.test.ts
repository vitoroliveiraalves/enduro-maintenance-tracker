import { describe, expect, it } from 'vitest'
import { parseDecimal } from '~/lib/parse-number'

describe('parseDecimal', () => {
  it('accepts a decimal comma', () => expect(parseDecimal('142,5')).toBe(142.5))
  it('accepts a decimal point', () => expect(parseDecimal('142.5')).toBe(142.5))
  it('ignores surrounding and thousands whitespace', () => expect(parseDecimal(' 3 812 ')).toBe(3812))
  it('returns null for text', () => expect(parseDecimal('abc')).toBeNull())
  it('returns null for empty input', () => expect(parseDecimal('')).toBeNull())
})
