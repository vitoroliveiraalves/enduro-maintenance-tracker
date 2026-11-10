import { describe, expect, it } from 'vitest'
import { DEFAULT_THEME, THEMES, applyTheme, readTheme, saveTheme } from '../../../app/lib/theme'

const store = (init: Record<string, string> = {}) => {
  const m = new Map(Object.entries(init))
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m }
}

describe('theme', () => {
  it('offers Stamped Steel and the tricolor (default)', () => {
    expect(THEMES.map((t) => t.id)).toEqual(['steel', 'tricolor'])
    expect(DEFAULT_THEME).toBe('tricolor')
  })

  it('reads the saved theme, falling back to the default for missing or unknown values or no storage', () => {
    expect(readTheme(store({ 'enduro.theme': 'steel' }))).toBe('steel')
    expect(readTheme(store({ 'enduro.theme': 'pink' }))).toBe('tricolor')
    expect(readTheme(store())).toBe('tricolor')
    expect(readTheme(null)).toBe('tricolor')
    expect(readTheme({ getItem: () => { throw new Error('blocked') }, setItem: () => {} })).toBe('tricolor')
  })

  it('saves and applies it to the root element', () => {
    const s = store()
    saveTheme(s, 'tricolor')
    expect(s.m.get('enduro.theme')).toBe('tricolor')
    const el = { dataset: {} as Record<string, string> }
    applyTheme(el, 'tricolor')
    expect(el.dataset.theme).toBe('tricolor')
    expect(() => saveTheme({ getItem: () => null, setItem: () => { throw new Error('full') } }, 'steel')).not.toThrow()
  })
})

describe('theme colour', () => {
  it('points the theme-color meta at the look background', async () => {
    const { applyThemeColor, THEME_COLORS } = await import('../../../app/lib/theme')
    const attrs: Record<string, string> = {}
    const doc = { querySelector: () => ({ setAttribute: (k: string, v: string) => void (attrs[k] = v) }) }
    applyThemeColor(doc, 'tricolor')
    expect(attrs.content).toBe(THEME_COLORS.tricolor)
    expect(() => applyThemeColor({ querySelector: () => null }, 'steel')).not.toThrow()
  })
})
