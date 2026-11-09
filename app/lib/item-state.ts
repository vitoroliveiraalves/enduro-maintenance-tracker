import type { ItemRowJson } from '../../server/domain/item-row'
import { formatDayMonth, formatKm } from './format'

type RowLike = Pick<ItemRowJson, 'status'>

/** Tenths of an hour as "20.5h" or "20h" (no trailing ".0"). */
const hoursShort = (tenths: number): string => `${Number((tenths / 10).toFixed(1))}h`
const plural = (n: number, unit: string): string => `${n} ${unit}${n === 1 ? '' : 's'}`
const DAYS_PER_MONTH = 30.4375

/** Right-hand row text in the driver's unit: "overdue 0.5h", "220 km left", "3 months left", "Unknown". */
export function stateText(row: RowLike): string {
  const { state, driver, remaining } = row.status
  if (state === 'unknown') return 'Unknown'
  const overdue = state === 'overdue'
  const left = driver === 'hours' ? remaining.hoursTenths : driver === 'km' ? remaining.km : remaining.days
  if (overdue && !left) return 'due now'
  const amount = (): string => {
    if (driver === 'hours') return hoursShort(Math.abs(remaining.hoursTenths ?? 0))
    if (driver === 'km') return formatKm(Math.abs(remaining.km ?? 0))
    const days = Math.abs(remaining.days ?? 0)
    return days >= 60 ? plural(Math.round(days / DAYS_PER_MONTH), 'month') : plural(days, 'day')
  }
  return overdue ? `overdue ${amount()}` : `${amount()} left`
}

type SubRow = Pick<ItemRowJson, 'status' | 'def' | 'last'>

/** Second line: "20.5h since last done (every 20h) · 12 Sep · garage". */
export function subline(row: SubRow): string {
  const { def, status, last } = row
  const every: Record<'hours' | 'km' | 'months', string | null> = {
    hours: def.everyHoursTenths ? hoursShort(def.everyHoursTenths) : null,
    km: def.everyKm ? formatKm(def.everyKm) : null,
    months: def.everyMonths ? `${def.everyMonths} months` : null,
  }
  const order = (['hours', 'km', 'months'] as const).filter((u) => every[u])
  const lead = status.driver ?? order[0]
  const list = [lead, ...order.filter((u) => u !== lead)].filter((u): u is 'hours' | 'km' | 'months' => !!u)
  const intervals = list.map((u) => every[u]).join(' or ')
  if (status.state === 'unknown' || !status.driver) return `Not logged yet (every ${intervals})`
  // Plain hours ridden first; multiplied (mud/sand/race) hours only when they differ.
  const plain = status.sinceHoursTenths ?? status.effectiveHoursTenths ?? 0
  const counted = status.effectiveHoursTenths ?? plain
  const since =
    status.driver === 'hours'
      ? hoursShort(plain) + ' since last done' + (Math.round(counted) !== plain ? `, counts as ${hoursShort(Math.round(counted))} with conditions` : '')
      : status.driver === 'km'
        ? `${formatKm(status.sinceKm ?? 0)} since last done`
        : `${Number((status.sinceMonths ?? 0).toFixed(1))} months since last done`
  let out = `${since} (every ${intervals})`
  if (last) out += ` · ${last.dateUnknown ? 'date unknown' : formatDayMonth(last.at)}`
  if (last?.by === 'garage') out += ' · garage'
  return out
}
