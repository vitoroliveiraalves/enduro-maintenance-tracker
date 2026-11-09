export type BikeMeters = 'hours_km' | 'km' | 'hours'

export const BIKE_METERS: readonly BikeMeters[] = ['hours_km', 'km', 'hours']

export const METERS_LABEL: Record<BikeMeters, string> = {
  hours_km: 'Hours & km',
  km: 'Km only',
  hours: 'Hours only'
}

export function isBikeMeters(v: unknown): v is BikeMeters {
  return typeof v === 'string' && (BIKE_METERS as readonly string[]).includes(v)
}

export function countsHours(m: BikeMeters): boolean {
  return m !== 'km'
}

export function countsKm(m: BikeMeters): boolean {
  return m !== 'hours'
}

/** Counted meters keep their value (undefined → null); uncounted become null. */
export function keepCounted(
  m: BikeMeters,
  v: { hoursTenths?: number | null; km?: number | null }
): { hoursTenths: number | null; km: number | null } {
  return {
    hoursTenths: countsHours(m) ? (v.hoursTenths ?? null) : null,
    km: countsKm(m) ? (v.km ?? null) : null
  }
}

/** An item's intervals as status should see them: uncounted units removed. */
export function countedDef<T extends { everyHoursTenths?: number | null; everyKm?: number | null }>(m: BikeMeters, def: T): T {
  const out = { ...def }
  if (!countsHours(m)) delete out.everyHoursTenths
  if (!countsKm(m)) delete out.everyKm
  return out
}
