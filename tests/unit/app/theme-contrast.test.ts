import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Every look must keep text readable (WCAG AA 4.5:1) and bars visible on their track (3:1).
const css = readFileSync('app/assets/css/main.css', 'utf8')
const vars = (block: string) => Object.fromEntries([...block.matchAll(/--color-([\w-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1]!, m[2]!]))
const steel = vars(css.slice(css.indexOf('@theme {'), css.indexOf('}', css.indexOf('@theme {'))))
const tri = { ...steel, ...vars(css.slice(css.indexOf("html[data-theme='tricolor'] {"), css.indexOf('}', css.indexOf("html[data-theme='tricolor'] {")))) }

const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}
const ratio = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p)
  return (x! + 0.05) / (y! + 0.05)
}

const TEXT: Array<[string, string]> = [
  ['text', 'bg'], ['text', 'surface'], ['muted', 'bg'], ['muted', 'surface'],
  ['accent-text', 'bg'], ['accent-text', 'surface'], ['danger-text', 'bg'], ['danger-text', 'surface'],
  ['warn-text', 'bg'], ['warn-text', 'surface'], ['ok-text', 'bg'], ['ok-text', 'surface'],
  ['on-accent', 'accent'], ['on-danger', 'danger'], ['on-warn', 'warn'],
]
const BARS = ['danger', 'warn', 'ok'] as const

describe.each([['steel', steel], ['tricolor', tri]] as const)('%s look', (_, t) => {
  it.each(TEXT)('%s on %s ≥ 4.5:1', (fg, bg) => {
    expect(t[fg], fg).toBeDefined()
    expect(ratio(t[fg]!, t[bg]!)).toBeGreaterThanOrEqual(4.5)
  })
  it.each(BARS)('%s bar ≥ 3:1 on the track', (bar) => {
    expect(ratio(t[bar]!, t.track!)).toBeGreaterThanOrEqual(3)
  })
  it('soon, ok and unknown bars are told apart', () => {
    expect(ratio(t.warn!, t.ok!)).toBeGreaterThanOrEqual(1.5)
    expect(ratio(t.warn!, t.muted!)).toBeGreaterThanOrEqual(1.2)
  })
})

const vue = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? vue(join(dir, f)) : f.endsWith('.vue') ? [join(dir, f)] : []))

describe('screens use the look', () => {
  it('text colours come from the readable *-text tokens, and no hard-coded colours remain', () => {
    const bad: string[] = []
    for (const f of vue('app')) {
      for (const [i, line] of readFileSync(f, 'utf8').split('\n').entries()) {
        if (/(?<![\w-])text-(accent|danger|warn|ok)(?![\w-])/.test(line)) bad.push(`${f}:${i + 1} plain text token`)
        if (/(bg|accent|text|border)-\[#[0-9a-f]{3,6}\]/i.test(line) && !f.endsWith('settings.vue')) bad.push(`${f}:${i + 1} hard-coded colour`)
      }
    }
    expect(bad).toEqual([])
  })
})
