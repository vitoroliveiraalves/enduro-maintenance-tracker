import { describe, expect, it } from 'vitest'
import { TEMPLATES } from '../../../server/domain/templates'

describe('TEMPLATES', () => {
  for (const stroke of ['2T', '4T'] as const) {
    it(`${stroke}: every item has a limit and names are unique`, () => {
      const items = TEMPLATES[stroke]
      expect(items.length).toBeGreaterThan(0)
      for (const i of items) {
        expect(i.everyHoursTenths || i.everyKm || i.everyMonths).toBeTruthy()
      }
      const names = items.map(i => i.name)
      expect(new Set(names).size).toBe(names.length)
    })
  }
})
