import { describe, expect, it } from 'vitest'
import { defaultCategory, matchLineToItems } from '../../../server/domain/invoice-match'
import { TEMPLATES } from '../../../server/domain/templates'

const itemsOf = (stroke: '2T' | '4T') => TEMPLATES[stroke].map((t, i) => ({ id: `${stroke}-${i}`, name: t.name }))
const names = (stroke: '2T' | '4T', desc: string) => {
  const items = itemsOf(stroke)
  return matchLineToItems(desc, items).map((id) => items.find((i) => i.id === id)!.name)
}

describe('matchLineToItems', () => {
  it('wheel bearings', () => {
    expect(names('2T', 'Rolamentos roda traseira')).toEqual(['Wheel bearings'])
    expect(names('4T', 'Rear wheel bearing kit')).toEqual(['Wheel bearings'])
  })

  it('oil + filter: engine oil on a 4T, gearbox oil on a 2T', () => {
    expect(names('4T', 'Óleo Motul 300V + filtro')).toEqual(['Engine oil + filter'])
    expect(names('2T', 'Óleo Motul 300V + filtro')).toEqual(['Gearbox oil'])
  })

  it('labour and tyres link no item', () => {
    expect(names('2T', 'Mão de obra')).toEqual([])
    expect(names('2T', 'Labour 1h')).toEqual([])
    expect(names('4T', 'Pneu Michelin Enduro Medium 140/80-18')).toEqual([])
  })

  it('the rest of the PT/EN keyword table', () => {
    expect(names('2T', 'Filtro de ar Twin Air')).toEqual(['Air filter clean'])
    expect(names('2T', 'Kit corrente + cremalheira + pinhão')).toEqual(['Chain & sprockets'])
    expect(names('2T', 'Retentores forqueta')).toEqual(['Fork service'])
    expect(names('2T', 'Revisão amortecedor')).toEqual(['Shock service'])
    expect(names('2T', 'Kit suspensão')).toEqual(['Fork service', 'Shock service'])
    expect(names('4T', 'Vela NGK')).toEqual(['Spark plug'])
    expect(names('2T', 'Líquido de travões DOT 4')).toEqual(['Brake fluid'])
    expect(names('2T', 'Pistão Vertex 72mm')).toEqual(['Piston & rings'])
    expect(names('2T', 'Líquido de refrigeração')).toEqual(['Coolant'])
  })

  it('fork oil is not engine/gearbox oil; pads only link to a pads item', () => {
    expect(names('2T', 'Óleo suspensão forqueta')).toEqual(['Fork service'])
    const items = [{ id: 'p', name: 'Brake pads front' }, { id: 'f', name: 'Brake fluid' }]
    expect(matchLineToItems('Pastilhas travão Galfer', items)).toEqual(['p'])
  })

  it('nothing matches an unknown line', () => {
    expect(names('4T', 'Autocolantes')).toEqual([])
  })
})

describe('defaultCategory', () => {
  it('maps by kind', () => {
    expect(defaultCategory('tyre', 'Pneu')).toBe('tyres')
    expect(defaultCategory('labour', 'Mão de obra')).toBe('labour')
    expect(defaultCategory('fluid', 'Óleo')).toBe('maintenance')
    expect(defaultCategory('part', 'Rolamentos roda traseira')).toBe('maintenance')
    expect(defaultCategory('other', 'Taxa ambiental')).toBe('other')
  })

  it('a part that is an upgrade goes to upgrades', () => {
    expect(defaultCategory('part', 'Proteção de cárter TM Design')).toBe('upgrades')
    expect(defaultCategory('part', 'Handguards Acerbis')).toBe('upgrades')
    expect(defaultCategory('part', 'Escape FMF Gnarly')).toBe('upgrades')
  })
})
