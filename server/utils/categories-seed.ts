import type { categoryKinds } from '../db/schema'

export const DEFAULT_CATEGORIES: { name: string; kind: (typeof categoryKinds)[number] }[] = [
  { name: 'Maintenance', kind: 'maintenance' },
  { name: 'Parts', kind: 'parts' },
  { name: 'Tyres & mousse', kind: 'tyres' },
  { name: 'Fuel & 2T oil', kind: 'fuel' },
  { name: 'Race entries', kind: 'race' },
  { name: 'Insurance / IUC / inspection', kind: 'insurance' },
  { name: 'Upgrades', kind: 'upgrades' },
  { name: 'Gear', kind: 'gear' },
  { name: 'Labour', kind: 'labour' },
  { name: 'Other', kind: 'other' },
]
