import { formatDate, formatDayMonth, formatWeekdayDay, formatHours, formatKm, formatMoney, formatQty } from '~/lib/format'

export function useFormatters() {
  return { money: formatMoney, hours: formatHours, km: formatKm, qty: formatQty, date: formatDate, dayMonth: formatDayMonth, weekdayDay: formatWeekdayDay }
}
