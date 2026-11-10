import type { ItemRowJson } from '../../server/domain/item-row'
import { formatDayMonth, formatKm } from './format'
import { activeLocale, msgs } from './i18n'

type RowLike = Pick<ItemRowJson, 'status'>

/** Tenths of an hour as "20.5h" or "20h" (no trailing ".0"). */
const decimal = (n: number): string => String(Number(n.toFixed(1))).replace('.', activeLocale.value === 'pt' ? ',' : '.')
const hoursShort = (tenths: number): string => `${decimal(tenths / 10)}h`
const DAYS_PER_MONTH = 30.4375

/** Right-hand row text in the driver's unit: "overdue 0.5h", "220 km left", "3 months left", "Unknown". */
export function stateText(row: RowLike): string {
  const { state, driver, remaining } = row.status
  const t = msgs().itemState
  if (state === 'unknown') return t.unknown
  const overdue = state === 'overdue'
  const left = driver === 'hours' ? remaining.hoursTenths : driver === 'km' ? remaining.km : remaining.days
  if (overdue && !left) return t.dueNow
  const amount = (): string => {
    if (driver === 'hours') return hoursShort(Math.abs(remaining.hoursTenths ?? 0))
    if (driver === 'km') return formatKm(Math.abs(remaining.km ?? 0))
    const days = Math.abs(remaining.days ?? 0)
    return days >= 60 ? t.months(Math.round(days / DAYS_PER_MONTH)) : t.days(days)
  }
  return overdue ? t.overdue(amount()) : t.left(amount())
}

type SubRow = Pick<ItemRowJson, 'status' | 'def' | 'last'>

/** Second line: "20.5h since last done (every 20h) · 12 Sep · garage". */
export function subline(row: SubRow): string {
  const { def, status, last } = row
  const t = msgs().itemState
  const every: Record<'hours' | 'km' | 'months', string | null> = {
    hours: def.everyHoursTenths ? hoursShort(def.everyHoursTenths) : null,
    km: def.everyKm ? formatKm(def.everyKm) : null,
    months: def.everyMonths ? t.months(def.everyMonths) : null,
  }
  const order = (['hours', 'km', 'months'] as const).filter((u) => every[u])
  const lead = status.driver ?? order[0]
  const list = [lead, ...order.filter((u) => u !== lead)].filter((u): u is 'hours' | 'km' | 'months' => !!u)
  // Every interval is in a unit the bike doesn't count (e.g. hours on a bike switched to km only).
  if (!list.length) return t.noInterval
  const intervals = list.map((u) => every[u]).join(t.or)
  if (status.state === 'unknown' || !status.driver) return t.notLogged(intervals)
  // Plain hours ridden first; multiplied (mud/sand/race) hours only when they differ.
  const plain = status.sinceHoursTenths ?? status.effectiveHoursTenths ?? 0
  const counted = status.effectiveHoursTenths ?? plain
  const since =
    status.driver === 'hours'
      ? t.sinceHours(hoursShort(plain)) + (Math.round(counted) !== plain ? t.countsAs(hoursShort(Math.round(counted))) : '')
      : status.driver === 'km'
        ? t.sinceKm(formatKm(status.sinceKm ?? 0))
        : t.sinceMonths(decimal(status.sinceMonths ?? 0))
  let out = t.every(since, intervals)
  if (last) out += ` · ${last.dateUnknown ? msgs().common.dateUnknown : formatDayMonth(last.at)}`
  if (last?.by === 'garage') out += ` · ${msgs().common.garage}`
  return out
}
