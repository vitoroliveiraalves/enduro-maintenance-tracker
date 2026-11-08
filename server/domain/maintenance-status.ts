export type Condition = 'normal' | 'mud' | 'sand' | 'dust' | 'race'
export type Reading = { at: Date, hoursTenths: number, km: number, condition: Condition }
export type ItemDef = {
  everyHoursTenths?: number
  everyKm?: number
  everyMonths?: number
  conditionMultipliers: Partial<Record<Condition, number>>
}
export type LastDone = { at: Date, hoursTenths?: number, km?: number } | null
export type Status = {
  state: 'overdue' | 'soon' | 'ok' | 'unknown'
  ratio: number | null
  driver: 'hours' | 'km' | 'months' | null
  sinceHoursTenths: number | null
  effectiveHoursTenths: number | null
  sinceKm: number | null
  sinceMonths: number | null
  remaining: { hoursTenths?: number, km?: number, days?: number }
}

export const SOON_RATIO = 0.8
export const OVERDUE_RATIO = 1
const DAYS_PER_MONTH = 30.4375
const MS_PER_DAY = 86_400_000

const byTime = (a: Reading, b: Reading) => a.at.getTime() - b.at.getTime() || a.hoursTenths - b.hoursTenths

/** Latest reading at or before `at`, by the given unit, as a baseline fallback. */
function baselineFromReadings(sorted: Reading[], at: Date, pick: (r: Reading) => number): number | null {
  let found: Reading | null = null
  for (const rd of sorted) {
    if (rd.at.getTime() <= at.getTime()) found = rd
    else break
  }
  return found ? pick(found) : null
}

export function computeStatus(def: ItemDef, last: LastDone, readings: Reading[], now: Date): Status {
  const sorted = [...readings].sort(byTime)
  const latest = sorted.at(-1) ?? null

  let sinceHours: number | null = null
  let effectiveHours: number | null = null
  let sinceKm: number | null = null
  let sinceMonths: number | null = null
  let daysSince: number | null = null

  if (last) {
    daysSince = (now.getTime() - last.at.getTime()) / MS_PER_DAY
    sinceMonths = daysSince / DAYS_PER_MONTH

    const baseH = last.hoursTenths ?? baselineFromReadings(sorted, last.at, rd => rd.hoursTenths)
    if (baseH !== null && latest) {
      sinceHours = Math.max(0, latest.hoursTenths - baseH)
      let eff = 0
      let prev = baseH
      for (const rd of sorted) {
        const delta = Math.max(0, rd.hoursTenths - Math.max(prev, baseH))
        eff += delta * (def.conditionMultipliers[rd.condition] ?? 1)
        prev = rd.hoursTenths
      }
      effectiveHours = Math.round(eff * 1000) / 1000
    }

    const baseKm = last.km ?? baselineFromReadings(sorted, last.at, rd => rd.km)
    if (baseKm !== null && latest) sinceKm = Math.max(0, latest.km - baseKm)
  }

  const ratios: Array<['hours' | 'km' | 'months', number]> = []
  const remaining: Status['remaining'] = {}
  if (def.everyHoursTenths && effectiveHours !== null) {
    ratios.push(['hours', effectiveHours / def.everyHoursTenths])
  }
  if (def.everyKm && sinceKm !== null) ratios.push(['km', sinceKm / def.everyKm])
  if (def.everyMonths && sinceMonths !== null) ratios.push(['months', sinceMonths / def.everyMonths])

  if (def.everyHoursTenths && effectiveHours !== null) {
    remaining.hoursTenths = Math.round(def.everyHoursTenths - effectiveHours)
  }
  if (def.everyKm && sinceKm !== null) remaining.km = def.everyKm - sinceKm
  if (def.everyMonths && daysSince !== null) {
    remaining.days = Math.round(def.everyMonths * DAYS_PER_MONTH - daysSince)
  }

  const base = { sinceHoursTenths: sinceHours, effectiveHoursTenths: effectiveHours, sinceKm, sinceMonths, remaining }
  if (ratios.length === 0) return { state: 'unknown', ratio: null, driver: null, ...base }

  // strict > keeps the first entry on ties: hours, then km, then months
  let [driver, ratio] = ratios[0]!
  for (const [u, v] of ratios) if (v > ratio) { driver = u; ratio = v }
  const state = ratio >= OVERDUE_RATIO ? 'overdue' : ratio >= SOON_RATIO ? 'soon' : 'ok'
  return { state, ratio, driver, ...base }
}

type Service = { at: Date, hoursTenths?: number, km?: number }

/** Highest hours, then km, then date — not the most recently created row. */
export function pickLastDone(services: Service[]): LastDone {
  if (services.length === 0) return null
  const n = (v: number | undefined) => v ?? Number.NEGATIVE_INFINITY
  const best = [...services].sort((a, b) =>
    n(b.hoursTenths) - n(a.hoursTenths) || n(b.km) - n(a.km) || b.at.getTime() - a.at.getTime()
  )[0]!
  const out: NonNullable<LastDone> = { at: best.at }
  if (best.hoursTenths !== undefined) out.hoursTenths = best.hoursTenths
  if (best.km !== undefined) out.km = best.km
  return out
}

const RANK: Record<Status['state'], number> = { overdue: 0, soon: 1, ok: 2, unknown: 3 }

export function sortByUrgency<T extends { status: Status }>(rows: T[]): T[] {
  return [...rows].sort((a, b) =>
    RANK[a.status.state] - RANK[b.status.state] || (b.status.ratio ?? 0) - (a.status.ratio ?? 0)
  )
}
