import type { ItemDef } from './maintenance-status'

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
