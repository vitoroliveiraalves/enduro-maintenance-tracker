const MS_PER_DAY = 86_400_000

/** Whole calendar days from the rider's local today to `dueOn` ("YYYY-MM-DD"); negative = past. */
export function daysUntil(dueOn: string, today: Date = new Date()): number {
  const [y, m, d] = dueOn.split('-').map(Number)
  const due = Date.UTC(y!, m! - 1, d!)
  const now = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())
  return Math.round((due - now) / MS_PER_DAY)
}

export function dueText(days: number): string {
  if (days < 0) return 'overdue'
  if (days === 0) return 'today'
  if (days === 1) return 'tomorrow'
  return `in ${days} days`
}

export const CHIP_DAYS = 30

export type DueChip = { id: string; text: string; tone: 'warn' | 'danger' }

/** Bike-screen chips: reminders due in 30 days or less (or overdue), in the given order. */
export function dueChips(list: Array<{ id: string; title: string; dueOn: string }>, today: Date = new Date()): DueChip[] {
  return list
    .map((r) => ({ r, days: daysUntil(r.dueOn, today) }))
    .filter(({ days }) => days <= CHIP_DAYS)
    .map(({ r, days }) => ({ id: r.id, text: `${r.title} · ${dueText(days)}`, tone: days < 0 ? 'danger' : 'warn' }))
}
