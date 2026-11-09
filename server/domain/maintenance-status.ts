export type Condition = 'normal' | 'mud' | 'sand' | 'dust' | 'race'
export type Reading = { at: Date, hoursTenths: number | null, km: number | null, condition: Condition }
export type ItemDef = {
  everyHoursTenths?: number
  everyKm?: number
  everyMonths?: number
  conditionMultipliers: Partial<Record<Condition, number>>
}
/** `dateUnknown`: only the meters are known (set-up without a date); months can't be judged. */
export type LastDone = {
  at: Date, hoursTenths?: number, km?: number, dateUnknown?: boolean
  /** Meters estimated from readings for a service logged without them (never shown as known). */
  estHoursTenths?: number, estKm?: number
} | null
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

const byTime = (a: Reading, b: Reading) => a.at.getTime() - b.at.getTime() || (a.hoursTenths ?? -1) - (b.hoursTenths ?? -1)

/** Latest reading at or before `at`, by the given unit, as a baseline fallback. */
function baselineFromReadings(sorted: Reading[], at: Date, pick: (r: Reading) => number | null): number | null {
  let found: number | null = null
  for (const rd of sorted) {
    if (rd.at.getTime() > at.getTime()) break
    const v = pick(rd)
    if (v !== null) found = v
  }
  return found
}

export function computeStatus(def: ItemDef, last: LastDone, readings: Reading[], now: Date): Status {
  const sorted = [...readings].sort(byTime)
  const latestH = sorted.findLast(rd => rd.hoursTenths !== null)?.hoursTenths ?? null
  const latestKm = sorted.findLast(rd => rd.km !== null)?.km ?? null

  let sinceHours: number | null = null
  let effectiveHours: number | null = null
  let sinceKm: number | null = null
  let sinceMonths: number | null = null
  let daysSince: number | null = null

  if (last) {
    // No real date → no months, and no meter baseline borrowed from "that day's" reading.
    const fromReadings = (pick: (r: Reading) => number | null) => (last.dateUnknown ? null : baselineFromReadings(sorted, last.at, pick))
    if (!last.dateUnknown) {
      daysSince = (now.getTime() - last.at.getTime()) / MS_PER_DAY
      sinceMonths = daysSince / DAYS_PER_MONTH
    }

    const baseH = last.hoursTenths ?? last.estHoursTenths ?? fromReadings(rd => rd.hoursTenths)
    if (baseH !== null && latestH !== null) {
      sinceHours = Math.max(0, latestH - baseH)
      let eff = 0
      let prev = baseH
      for (const rd of sorted) {
        if (rd.hoursTenths === null) continue
        const delta = Math.max(0, rd.hoursTenths - Math.max(prev, baseH))
        eff += delta * (def.conditionMultipliers[rd.condition] ?? 1)
        prev = rd.hoursTenths
      }
      effectiveHours = Math.round(eff * 1000) / 1000
    }

    const baseKm = last.km ?? last.estKm ?? fromReadings(rd => rd.km)
    if (baseKm !== null && latestKm !== null) sinceKm = Math.max(0, latestKm - baseKm)
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

type Service = { at: Date, hoursTenths?: number, km?: number, dateUnknown?: boolean }

/**
 * The service that counts: highest hours, then km, then date — not the most
 * recently created row. A service logged without meters (mark done or invoice
 * with blank hours/km) gets them from the latest reading on or before its day,
 * or else the first reading after it, so it ranks where it really happened:
 * a newer one still resets the item, a backdated one never looks fresher.
 */
export function pickLastDone(services: Service[], readings: Reading[] = []): LastDone {
  if (services.length === 0) return null
  const sorted = [...readings].sort(byTime)
  const estimate = (s: Service, pick: (r: Reading) => number | null): number | undefined => {
    if (s.dateUnknown || !sorted.length) return undefined
    // Same calendar day counts as "on or before" (a service is a day, a reading a moment).
    const endOfDay = s.at.getTime() + 86_400_000 - 1
    let found: number | undefined
    for (const rd of sorted) {
      if (rd.at.getTime() > endOfDay) break
      found = pick(rd) ?? found
    }
    if (found !== undefined) return found
    for (const rd of sorted) {
      if (rd.at.getTime() > endOfDay) found = pick(rd) ?? undefined
      if (found !== undefined) return found
    }
    return undefined
  }
  const keyed = services.map((s) => ({
    s,
    h: s.hoursTenths ?? estimate(s, (r) => r.hoursTenths),
    k: s.km ?? estimate(s, (r) => r.km),
  }))
  const n = (v: number | undefined) => v ?? Number.NEGATIVE_INFINITY
  const best = keyed.sort((a, b) => n(b.h) - n(a.h) || n(b.k) - n(a.k) || b.s.at.getTime() - a.s.at.getTime())[0]!
  const out: NonNullable<LastDone> = { at: best.s.at }
  if (best.s.hoursTenths !== undefined) out.hoursTenths = best.s.hoursTenths
  else if (best.h !== undefined) out.estHoursTenths = best.h
  if (best.s.km !== undefined) out.km = best.s.km
  else if (best.k !== undefined) out.estKm = best.k
  if (best.s.dateUnknown) out.dateUnknown = true
  return out
}

const RANK: Record<Status['state'], number> = { overdue: 0, soon: 1, ok: 2, unknown: 3 }

export function sortByUrgency<T extends { status: Status }>(rows: T[]): T[] {
  return [...rows].sort((a, b) =>
    RANK[a.status.state] - RANK[b.status.state] || (b.status.ratio ?? 0) - (a.status.ratio ?? 0)
  )
}
