import { msgs } from './i18n'
import { categoryLabel, itemLabel } from './server-text'
import { formatDayMonth, formatHours, formatKm, formatMoney, formatQty } from './format'

type O = Record<string, unknown>
const isO = (v: unknown): v is O => typeof v === 'object' && v !== null && !Array.isArray(v)
const n = (v: unknown) => (typeof v === 'number' ? v : null)
const t = (v: unknown) => (typeof v === 'string' ? v : '')
const join = (...parts: Array<string | null | false | undefined>) => parts.filter(Boolean).join(' · ')
const meters = (o: O, h = 'hoursTenths', k = 'km') => [n(o[h]) !== null && formatHours(n(o[h])!), n(o[k]) !== null && formatKm(n(o[k])!)]
const day = (v: unknown) => (t(v) ? formatDayMonth(t(v)) : null)

const MAX_LINES = 6

/** "From your records": the facts a tool returned, in the app's own formats (never the model's words). */
export function sourceLines(src: { tool: string; data: unknown }): string[] {
  const d = src.data
  if (isO(d) && 'error' in d) return []
  const list = (rows: unknown, f: (o: O) => string) => (Array.isArray(rows) ? rows.filter(isO).slice(0, MAX_LINES).map(f) : [])
  switch (src.tool) {
    case 'list_bikes':
      return list(d, (b) => join(t(b.name), ...meters(b)))
    case 'item_status':
      return list(isO(d) ? d.items : [], (i) => {
        const last = isO(i.lastDone) ? i.lastDone : null
        return join(
          itemLabel(t(i.name)),
          last ? msgs().voiceSources.lastDone(join(day(last.at) ?? msgs().common.dateUnknown, ...meters(last))) : msgs().voiceSources.neverLogged,
          n(i.sinceHoursTenths) !== null && msgs().voiceSources.since(formatHours(n(i.sinceHoursTenths)!)),
          n(i.sinceKm) !== null && msgs().voiceSources.since(formatKm(n(i.sinceKm)!)),
        )
      })
    case 'item_history':
      return list(d, (s) => join(day(s.at) ?? msgs().common.dateUnknown, ...meters(s), s.by === 'garage' ? t(s.garageName) || msgs().common.garage : msgs().common.diy, n(s.totalCents) ? formatMoney(n(s.totalCents)!) : null))
    case 'search_shelf':
      return list(d, (p) => join(t(p.name), msgs().voiceSources.inStock(formatQty(n(p.qtyHundredths) ?? 0, t(p.unit) || 'pcs'))))
    case 'shopping_list': {
      if (!isO(d)) return []
      const auto = list(d.auto, (a) => join(t(a.partName), t(a.detail)))
      return [...auto, ...list(d.manual, (m) => t(m.text))].slice(0, MAX_LINES)
    }
    case 'costs':
      if (!isO(d)) return []
      return [msgs().voiceSources.total(formatMoney(n(d.totalCents) ?? 0)), ...list(d.byCategory, (c) => join(categoryLabel(t(c.name)), formatMoney(n(c.cents) ?? 0)))].slice(0, MAX_LINES)
    case 'reminders':
      return list(d, (r) => join(t(r.title), msgs().voiceSources.due(day(r.dueOn) ?? ''), t(r.bikeName)))
    default:
      return []
  }
}
