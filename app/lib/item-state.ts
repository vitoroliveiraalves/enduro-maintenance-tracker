import type { ItemRowJson } from '../../server/domain/item-row'
import { formatHours, formatKm } from './format'

/** Short state label for an item row: "overdue 5.5 h", "12.0 h left", "Unknown — set last done". */
export function stateText(row: Pick<ItemRowJson, 'status'>): string {
  const { state, driver, remaining } = row.status
  if (state === 'unknown') return 'Unknown — set last done'
  const days = remaining.days ?? 0
  const amount = (sign: 1 | -1): string => {
    if (driver === 'hours') return formatHours(sign * (remaining.hoursTenths ?? 0)).replace(' h', 'h')
    if (driver === 'km') return formatKm(sign * (remaining.km ?? 0))
    const months = Math.max(1, Math.round((sign * days) / 30.4375))
    return Math.abs(sign * days) < 30 ? `${sign * days} d` : `${months} mo`
  }
  return state === 'overdue' ? `overdue ${amount(-1)}` : `${amount(1)} left`
}
