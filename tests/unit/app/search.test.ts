import { describe, expect, it } from 'vitest'
import { matches, normalise } from '../../../shared/utils/search'

describe('search', () => {
  it('normalises accents, case and edges', () => {
    expect(normalise('  ÓLEO Motor ')).toBe('oleo motor')
  })
  it('matches every word in some field, ignoring accents and case', () => {
    expect(matches('junta', 'Junta escape')).toBe(true)
    expect(matches('JUNTA esc', 'junta de escape')).toBe(true)
    expect(matches('óleo', 'Oleo motor')).toBe(true)
    expect(matches('junta ktm', 'Junta escape', 'KTM 300')).toBe(true)
    expect(matches('filtro ar', 'Filtro óleo')).toBe(false)
  })
  it('empty query matches all; null fields are fine', () => {
    expect(matches('  ', 'x')).toBe(true)
    expect(matches('a', null, undefined)).toBe(false)
  })
})
