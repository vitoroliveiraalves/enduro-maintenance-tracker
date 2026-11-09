import { describe, expect, it } from 'vitest'
import { TEMPLATES, templatesFor } from '../../../server/domain/templates'

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

describe('templatesFor', () => {
  it('km 4T: the street list, in order, no hours', () => {
    const items = templatesFor('4T', 'km')
    expect(items.map((i) => i.name)).toEqual([
      'Engine oil + filter', 'Air filter', 'Spark plug', 'Valve clearance check', 'Chain & sprockets',
      'Chain clean & lube', 'Tyres', 'Brake pads check', 'Brake fluid', 'Coolant',
    ])
    expect(items.some((i) => i.everyHoursTenths)).toBe(false)
    expect(items[0]).toMatchObject({ everyKm: 6000, everyMonths: 12 })
    expect(items.find((i) => i.name === 'Brake pads check')).toMatchObject({ everyKm: 6000, everyMonths: 12 })
  })
  it('km 2T: no engine oil or valves, spark plug 6 000 km, gearbox oil', () => {
    const items = templatesFor('2T', 'km')
    const names = items.map((i) => i.name)
    expect(names).not.toContain('Engine oil + filter')
    expect(names).not.toContain('Valve clearance check')
    expect(items.find((i) => i.name === 'Spark plug')).toMatchObject({ everyKm: 6000 })
    expect(items.find((i) => i.name === 'Gearbox oil')).toMatchObject({ everyKm: 10000, everyMonths: 24 })
    expect(items.some((i) => i.everyHoursTenths)).toBe(false)
  })
  it('hours: no km anywhere, chain every 30 h', () => {
    for (const stroke of ['2T', '4T'] as const) {
      const items = templatesFor(stroke, 'hours')
      expect(items.some((i) => i.everyKm)).toBe(false)
      expect(items.find((i) => i.name === 'Chain & sprockets')).toMatchObject({ everyHoursTenths: 300 })
      for (const i of items) expect(i.everyHoursTenths || i.everyMonths).toBeTruthy()
    }
  })
  it('hours_km is today\'s list, and every call is a fresh copy', () => {
    expect(templatesFor('4T', 'hours_km')).toEqual(TEMPLATES['4T'])
    templatesFor('4T', 'km')[0]!.name = 'changed'
    expect(templatesFor('4T', 'km')[0]!.name).toBe('Engine oil + filter')
    templatesFor('2T', 'hours_km')[0]!.name = 'changed'
    expect(TEMPLATES['2T'][0]!.name).toBe('Gearbox oil')
  })
})
