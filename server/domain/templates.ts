import type { ItemDef } from './maintenance-status'
import type { BikeMeters } from '../../shared/utils/meters'

type TemplateItem = { name: string } & ItemDef

const heavy = { mud: 1.5, sand: 1.5, dust: 1.5, race: 1.5 }

// Hours are stored in tenths: 15 h -> 150.
const common: TemplateItem[] = [
  { name: 'Chain & sprockets', everyKm: 1500, conditionMultipliers: {} },
  { name: 'Wheel bearings', everyHoursTenths: 500, conditionMultipliers: {} },
  { name: 'Brake fluid', everyMonths: 12, conditionMultipliers: {} },
  { name: 'Coolant', everyMonths: 24, conditionMultipliers: {} }
]

export const TEMPLATES: Record<'2T' | '4T', TemplateItem[]> = {
  '2T': [
    { name: 'Gearbox oil', everyHoursTenths: 150, conditionMultipliers: {} },
    { name: 'Air filter clean', everyHoursTenths: 50, conditionMultipliers: { ...heavy } },
    { name: 'Spark plug', everyHoursTenths: 300, conditionMultipliers: {} },
    { name: 'Piston & rings', everyHoursTenths: 800, conditionMultipliers: {} },
    common[0]!,
    common[1]!,
    { name: 'Fork service', everyHoursTenths: 500, everyMonths: 12, conditionMultipliers: {} },
    { name: 'Shock service', everyHoursTenths: 500, everyMonths: 12, conditionMultipliers: {} },
    common[2]!,
    common[3]!
  ],
  '4T': [
    { name: 'Engine oil + filter', everyHoursTenths: 150, conditionMultipliers: { ...heavy } },
    { name: 'Air filter clean', everyHoursTenths: 50, conditionMultipliers: { ...heavy } },
    { name: 'Valve clearance check', everyHoursTenths: 300, conditionMultipliers: {} },
    { name: 'Spark plug', everyHoursTenths: 300, conditionMultipliers: {} },
    common[0]!,
    common[1]!,
    { name: 'Fork service', everyHoursTenths: 500, everyMonths: 12, conditionMultipliers: {} },
    { name: 'Shock service', everyHoursTenths: 500, everyMonths: 12, conditionMultipliers: {} },
    common[2]!,
    common[3]!
  ]
}

const n = (name: string, o: Omit<TemplateItem, 'name' | 'conditionMultipliers'>): TemplateItem => ({ name, ...o, conditionMultipliers: {} })

// Street bikes (km only): the rider edits this at set-up anyway.
const STREET_4T: TemplateItem[] = [
  n('Engine oil + filter', { everyKm: 6000, everyMonths: 12 }),
  n('Air filter', { everyKm: 12000 }),
  n('Spark plug', { everyKm: 12000 }),
  n('Valve clearance check', { everyKm: 24000 }),
  n('Chain & sprockets', { everyKm: 20000 }),
  n('Chain clean & lube', { everyKm: 1000 }),
  n('Tyres', { everyKm: 10000 }),
  n('Brake pads check', { everyKm: 6000, everyMonths: 12 }),
  n('Brake fluid', { everyMonths: 24 }),
  n('Coolant', { everyMonths: 24 }),
]
const STREET_2T: TemplateItem[] = [
  n('Gearbox oil', { everyKm: 10000, everyMonths: 24 }),
  ...STREET_4T.filter((i) => i.name !== 'Engine oil + filter' && i.name !== 'Valve clearance check').map((i) =>
    i.name === 'Spark plug' ? { ...i, everyKm: 6000 } : i,
  ),
]

/** Hours only: km intervals dropped; an item left with nothing is dropped, except the chain (every 30 h). */
function hoursOnly(list: TemplateItem[]): TemplateItem[] {
  return list.flatMap((i): TemplateItem[] => {
    if (i.name === 'Chain & sprockets') return [{ name: i.name, everyHoursTenths: 300, conditionMultipliers: { ...i.conditionMultipliers } }]
    const rest: TemplateItem = { ...i }
    delete rest.everyKm
    return rest.everyHoursTenths || rest.everyMonths ? [rest] : []
  })
}

/** The starting list for a bike, always a fresh copy. */
export function templatesFor(stroke: '2T' | '4T', meters: BikeMeters): TemplateItem[] {
  const list = meters === 'km' ? (stroke === '4T' ? STREET_4T : STREET_2T) : meters === 'hours' ? hoursOnly(TEMPLATES[stroke]) : TEMPLATES[stroke]
  return structuredClone(list)
}
