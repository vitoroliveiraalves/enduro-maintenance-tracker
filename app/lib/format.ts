import { activeLocale } from './i18n'

const THIN_SPACE = String.fromCharCode(0x202f)
/** Decimal mark for hours and quantities: '.' in English, ',' in Portuguese (money is always 1.234,56 €). */
const dec = () => (activeLocale.value === 'pt' ? ',' : '.')

function groupThousands(digits: string, sep: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, sep)
}

/** Integer cents EUR -> "1.234,56 €". */
export function formatMoney(cents: number): string {
  const abs = Math.abs(Math.round(cents))
  const euros = groupThousands(String(Math.floor(abs / 100)), '.')
  const rest = String(abs % 100).padStart(2, '0')
  return `${cents < 0 ? '-' : ''}${euros},${rest} €`
}

/** Tenths of an hour -> "142.5 h" ("142,5 h" in Portuguese). */
export function formatHours(tenths: number): string {
  return `${(tenths / 10).toFixed(1).replace('.', dec())} h`
}

/** Integer km -> "3 812 km" (thin-space thousands). */
export function formatKm(km: number): string {
  return `${groupThousands(String(Math.round(km)), THIN_SPACE)} km`
}

const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTHS_PT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const month = (i: number) => (activeLocale.value === 'pt' ? MONTHS_PT : MONTHS_EN)[i]

/** Date or ISO string -> "6 Oct 2026" (UTC calendar day for ISO date strings). */
export function formatDate(value: Date | string): string {
  const d = typeof value === 'string' ? new Date(value) : value
  return `${d.getUTCDate()} ${month(d.getUTCMonth())} ${d.getUTCFullYear()}`
}

/** Tenths of an hour -> "1 282.5 h" (thin-space thousands), for sentences about big amounts. */
export function formatHoursLong(tenths: number): string {
  const [whole = '0', frac = '0'] = (Math.abs(tenths) / 10).toFixed(1).split('.')
  return `${tenths < 0 ? '-' : ''}${groupThousands(whole, THIN_SPACE)}${dec()}${frac} h`
}

/** ISO string -> "12 Sep" (UTC calendar day). */
export function formatDayMonth(value: Date | string): string {
  const d = typeof value === 'string' ? new Date(value) : value
  return `${d.getUTCDate()} ${month(d.getUTCMonth())}`
}

const WEEKDAYS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const WEEKDAYS_PT = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']

/** Timestamp -> "Sun, 2 Nov" in the rider's local time. */
export function formatWeekdayDay(value: Date | string): string {
  const d = typeof value === 'string' ? new Date(value) : value
  return `${(activeLocale.value === 'pt' ? WEEKDAYS_PT : WEEKDAYS_EN)[d.getDay()]}, ${d.getDate()} ${month(d.getMonth())}`
}

/** Hundredths of a unit -> "2", "1.5 L", "−1" ('pcs' shows no unit). */
export function formatQty(hundredths: number, unit = 'pcs'): string {
  const abs = Math.abs(Math.round(hundredths))
  const whole = groupThousands(String(Math.floor(abs / 100)), THIN_SPACE)
  const frac = String(abs % 100).padStart(2, '0').replace(/0+$/, '')
  const n = `${hundredths < 0 && abs > 0 ? '−' : ''}${whole}${frac ? `${dec()}${frac}` : ''}`
  return unit && unit !== 'pcs' ? `${n} ${unit}` : n
}
