import { describe, expect, it } from 'vitest'
import { buildPageIndex, normalisePdfText, searchPdfPages } from '../../../app/lib/pdf-search'

describe('pdf-search', () => {
  it('normalises accents and case while preserving character positions', () => {
    expect(normalisePdfText('Óleo de Suspensão  10W')).toBe('oleo de suspensao 10w')
  })

  it('indexes spans and searches across pages with snippets and bounding rects', () => {
    const page1 = buildPageIndex(1, [
      { str: 'Front axle nut', rect: [10, 700, 120, 712] },
      { str: 'torque 85 Nm', rect: [125, 700, 210, 712] },
      { str: 'and Óleo 10W capacity 615 ml', rect: [10, 680, 240, 692] },
    ])
    const page2 = buildPageIndex(2, [
      { str: 'Spark plug gap 0.6 mm', rect: [20, 650, 160, 662] },
      { str: 'and rear axle nut torque 100 Nm', rect: [20, 630, 220, 642] },
    ])

    expect(searchPdfPages([page1, page2], '   ')).toEqual([])

    // Accent-insensitive and case-insensitive match
    const oilMatches = searchPdfPages([page1, page2], 'oleo')
    expect(oilMatches).toHaveLength(1)
    expect(oilMatches[0]!.page).toBe(1)
    expect(oilMatches[0]!.snippetMatch).toBe('Óleo')
    expect(oilMatches[0]!.rects).toEqual([[10, 680, 240, 692]])

    // Multi-span phrase match on page 1
    const nutMatches = searchPdfPages([page1, page2], 'nut torque 85 nm')
    expect(nutMatches).toHaveLength(1)
    expect(nutMatches[0]!.page).toBe(1)
    expect(nutMatches[0]!.snippetMatch).toBe('nut torque 85 Nm')
    expect(nutMatches[0]!.rects).toEqual([
      [10, 700, 120, 712],
      [125, 700, 210, 712],
    ])

    // Multi-page ordered matches
    const torqueMatches = searchPdfPages([page1, page2], 'torque')
    expect(torqueMatches).toHaveLength(2)
    expect(torqueMatches.map((m) => [m.index, m.page])).toEqual([
      [0, 1],
      [1, 2],
    ])
    expect(torqueMatches[1]!.snippetBefore).toContain('rear axle nut ')
    expect(torqueMatches[1]!.snippetAfter).toContain(' 100 Nm')
  })
})
