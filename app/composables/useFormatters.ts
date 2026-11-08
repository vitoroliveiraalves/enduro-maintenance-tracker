import { formatDate, formatHours, formatKm, formatMoney } from '~/lib/format'

export function useFormatters() {
  return { money: formatMoney, hours: formatHours, km: formatKm, date: formatDate }
}
