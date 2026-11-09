import { formatHours, formatKm } from './format'

type Row = { id: string; name: string; status: { state: string } }
const WORSE = { overdue: 'now overdue', soon: 'due soon' } as const

/** "Ride saved · 145.0 h · 3 880 km · Air filter clean now overdue". */
export function rideToast(before: Row[], meters: { hoursTenths: number; km: number }, after: Row[], queued: boolean): string {
  const m = `${formatHours(meters.hoursTenths)} · ${formatKm(meters.km)}`
  if (queued) return `Ride saved on this phone · ${m} · syncs when online`
  const was = new Map(before.map((r) => [r.id, r.status.state]))
  const changed = after
    .filter((r) => (r.status.state === 'overdue' || r.status.state === 'soon') && was.get(r.id) !== r.status.state)
    .map((r) => `${r.name} ${WORSE[r.status.state as keyof typeof WORSE]}`)
  return ['Ride saved', m, ...changed].join(' · ')
}
