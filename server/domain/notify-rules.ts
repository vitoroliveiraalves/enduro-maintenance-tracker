import type { Status } from './maintenance-status'

export const DEFAULT_TIMEZONE = 'Europe/Lisbon'
const MS_PER_DAY = 86_400_000

export type NotifyInput = {
  now: Date
  items: Array<{ bikeId: string; bikeName: string; itemId: string; itemName: string; lastServiceId: string | null; status: Status }>
  /** Open (not done) reminders; `dueOn` is the calendar day at 00:00 UTC. */
  reminders: Array<{ id: string; title: string; dueOn: Date }>
  lastReadingAt: Date | null
  /** IANA zone of the subscription; unknown/empty → Europe/Lisbon. */
  timezone?: string | null
}

export type DueNotification = { key: string; title: string; body: string; url: string }

export function validTimezone(tz: unknown): string | null {
  if (typeof tz !== 'string' || !tz || tz.length > 64) return null
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return tz
  } catch {
    return null
  }
}

const WEEKDAY: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }

/** Calendar day ("YYYY-MM-DD"), ISO weekday (Mon=1) and hour of `at` in `tz`. */
export function localParts(at: Date, tz: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'short',
      hour: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  )
  return { day: `${parts.year}-${parts.month}-${parts.day}`, weekday: WEEKDAY[parts.weekday!]!, hour: Number(parts.hour) }
}

const dayMs = (day: string) => Date.parse(`${day}T00:00:00Z`)
const addDays = (day: string, n: number) => new Date(dayMs(day) + n * MS_PER_DAY).toISOString().slice(0, 10)

/** ISO-8601 week of a calendar day, e.g. "2026-W47". */
export function isoWeek(day: string): string {
  const d = new Date(dayMs(day))
  const dow = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dow) // Thursday of this week decides the year
  const year = d.getUTCFullYear()
  const week = Math.ceil(((d.getTime() - Date.UTC(year, 0, 1)) / MS_PER_DAY + 1) / 7)
  return `${year}-W${String(week).padStart(2, '0')}`
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`

/** Everything that should be pushed right now; the caller dedupes by `key` via notificationsSent. */
export function notificationsDue(input: NotifyInput): DueNotification[] {
  const tz = validTimezone(input.timezone) ?? DEFAULT_TIMEZONE
  const local = localParts(input.now, tz)
  const out: DueNotification[] = []

  for (const it of input.items) {
    const url = `/bikes/${it.bikeId}/items/${it.itemId}`
    if (it.status.state === 'overdue') {
      out.push({ key: `item:${it.itemId}:overdue:${it.lastServiceId ?? 'none'}`, title: `${it.itemName} is overdue`, body: `${it.bikeName}: time to do the ${it.itemName.toLowerCase()}.`, url })
    } else if (it.status.state === 'soon') {
      out.push({ key: `item:${it.itemId}:soon`, title: `${it.itemName} due soon`, body: `${it.bikeName}: plan the ${it.itemName.toLowerCase()}.`, url })
    }
  }

  for (const r of input.reminders) {
    const days = Math.round((r.dueOn.getTime() - dayMs(local.day)) / MS_PER_DAY)
    const url = '/settings#reminders'
    if (days <= 0) {
      out.push({ key: `reminder:${r.id}:0d`, title: `${r.title} is due`, body: days === 0 ? `${r.title} is due today.` : `${r.title} was due ${plural(-days, 'day')} ago.`, url })
    } else if (days <= 7) {
      out.push({ key: `reminder:${r.id}:7d`, title: `${r.title} coming up`, body: `${r.title} is due in ${plural(days, 'day')}.`, url })
    }
  }

  // Monday from 09:00 local: nudge if nothing was logged since the previous Friday.
  if (local.weekday === 1 && local.hour >= 9 && input.lastReadingAt) {
    const friday = addDays(local.day, -3)
    if (localParts(input.lastReadingAt, tz).day < friday) {
      out.push({ key: `nudge:${isoWeek(local.day)}`, title: 'Ride this weekend?', body: 'Update your hours and km so maintenance stays on track.', url: '/' })
    }
  }
  return out
}
