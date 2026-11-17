export type TopUpServiceItem = {
  topUp?: boolean
  topUpMl?: number | null
  km: number | null
  hoursTenths: number | null
}

export type TopUpSummary = {
  count: number
  totalMl: number
  litersPer1000Km: number | null
  mlPer10Hours: number | null
}

/** Format a volume in ml concisely (e.g. `500 ml`, `1.0 L`, `1.25 L`). */
export function formatVolumeMl(ml: number): string {
  if (ml < 1000) return `${ml} ml`
  const liters = ml / 1000
  return `${liters.toFixed(ml % 100 === 0 ? 1 : 2)} L`
}

/**
 * Compute top-up totals and consumption rate since the most recent full service.
 * `services` is ordered newest-first (as returned by `/api/items/:id/history`).
 */
export function computeTopUpSummary(
  services: TopUpServiceItem[],
  latestReading: { km: number | null; hoursTenths: number | null } | null,
): TopUpSummary | null {
  const lastFullIdx = services.findIndex((s) => !s.topUp)
  const lastFull = lastFullIdx >= 0 ? services[lastFullIdx]! : null
  const topUps = (lastFullIdx >= 0 ? services.slice(0, lastFullIdx) : services).filter((s) => s.topUp)
  if (!topUps.length) return null

  const totalMl = topUps.reduce((sum, s) => sum + (s.topUpMl ?? 0), 0)

  let litersPer1000Km: number | null = null
  const maxTopUpKm = topUps.reduce((m, s) => (s.km != null && s.km > m ? s.km : m), 0)
  const endKm = Math.max(latestReading?.km ?? 0, maxTopUpKm)

  if (lastFull?.km != null && totalMl > 0 && endKm - lastFull.km >= 100) {
    litersPer1000Km = Math.round((totalMl / (endKm - lastFull.km)) * 100) / 100
  } else if (lastFull?.km == null) {
    const withKm = topUps.filter((s) => s.km != null).sort((a, b) => a.km! - b.km!)
    if (withKm.length >= 2) {
      const startKm = withKm[0]!.km!
      const afterMl = withKm.slice(1).reduce((sum, s) => sum + (s.topUpMl ?? 0), 0)
      if (afterMl > 0 && endKm - startKm >= 100) {
        litersPer1000Km = Math.round((afterMl / (endKm - startKm)) * 100) / 100
      }
    }
  }

  let mlPer10Hours: number | null = null
  const maxTopUpH = topUps.reduce((m, s) => (s.hoursTenths != null && s.hoursTenths > m ? s.hoursTenths : m), 0)
  const endH = Math.max(latestReading?.hoursTenths ?? 0, maxTopUpH)

  if (lastFull?.hoursTenths != null && totalMl > 0 && endH - lastFull.hoursTenths >= 10) {
    mlPer10Hours = Math.round(totalMl / ((endH - lastFull.hoursTenths) / 100))
  }

  return {
    count: topUps.length,
    totalMl,
    litersPer1000Km,
    mlPer10Hours,
  }
}
