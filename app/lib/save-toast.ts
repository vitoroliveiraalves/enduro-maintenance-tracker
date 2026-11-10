import { msgs } from './i18n'
import { formatHours, formatKm } from './format'

type Row = { id: string; name: string; status: { state: string } }

/** "Ride saved · 145.0 h · 3 880 km · Air filter clean now overdue". */
export function rideToast(before: Row[], meters: { hoursTenths: number | null; km: number | null }, after: Row[], queued: boolean): string {
  // Only the meters the reading has (a km-only bike never shows hours).
  const m = [meters.hoursTenths !== null ? formatHours(meters.hoursTenths) : '', meters.km !== null ? formatKm(meters.km) : ''].filter(Boolean).join(' · ')
  const t = msgs().rideToast
  const WORSE = { overdue: t.nowOverdue, soon: t.dueSoon }
  if (queued) return t.savedHere(m)
  const was = new Map(before.map((r) => [r.id, r.status.state]))
  const changed = after
    .filter((r) => (r.status.state === 'overdue' || r.status.state === 'soon') && was.get(r.id) !== r.status.state)
    .map((r) => `${r.name} ${WORSE[r.status.state as keyof typeof WORSE]}`)
  return [t.saved, m, ...changed].join(' · ')
}
