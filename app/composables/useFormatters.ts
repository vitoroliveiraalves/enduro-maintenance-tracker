import { formatDate, formatDayMonth, formatWeekdayDay, formatHours, formatKm, formatMoney } from '~/lib/format'

export function useFormatters() {
  return { money: formatMoney, hours: formatHours, km: formatKm, date: formatDate, dayMonth: formatDayMonth, weekdayDay: formatWeekdayDay }
}
