import { msgs } from './i18n'
import { countsHours, countsKm, type BikeMeters } from '../../shared/utils/meters'
import { parseDecimal } from './parse-number'

/** What the cards need to show names and fill pickers. */
export type CardCtx = {
  bikes: Array<{ id: string; name: string; meters: BikeMeters; latestReading: { at: string; hoursTenths: number | null; km: number | null } | null }>
  parts: Array<{ id: string; name: string; unit: string; qtyHundredths: number }>
  categories: Array<{ id: string; name: string }>
  today: string
}
type P = Record<string, unknown> & { kind: string }

/** One editable card. Inputs are strings, as typed; ids for every create are fixed once, so a retry is safe. */
export type Draft = {
  key: string
  kind: string
  clientId: string
  startClientId: string
  status: 'idle' | 'saving' | 'saved' | 'failed'
  error: string
  bikeId: string
  /** Bikes to pick from when the note didn't say which (null: no picker). */
  bikeChoices: string[] | null
  itemIds: string[]
  /** Items offered when unsure (null: every item of the bike). */
  itemChoices: string[] | null
  partId: string
  partChoices: string[] | null
  categoryId: string
  categoryChoices: string[] | null
  hours: string
  km: string
  at: string
  by: 'diy' | 'garage'
  garageName: string
  notes: string
  partsUsed: Array<{ clientId: string; partId: string; qty: string }>
  qty: string
  name: string
  unit: string
  text: string
  amount: string
  description: string
  title: string
  dueOn: string
  repeatYearly: boolean
}

const s = (v: unknown) => (typeof v === 'string' ? v : '')
const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
const tenths = (v: unknown) => (typeof v === 'number' ? String(v / 10) : '')
const whole = (v: unknown) => (typeof v === 'number' ? String(v) : '')
const hundredths = (v: unknown) => (typeof v === 'number' ? String(v / 100).replace('.', ',') : '')
const euros = (v: unknown) => (typeof v === 'number' ? (v / 100).toFixed(2).replace('.', ',') : '')

/** Single id, or a picker over the candidates (all options when none are left). */
function choice(p: P, key: string, all: string[]): [string, string[] | null] {
  if (typeof p[key] === 'string') return [p[key] as string, null]
  const c = ids(p.candidates)
  return ['', c.length ? c : all]
}

export function draftFrom(p: P, ctx: CardCtx): Draft {
  const allBikes = ctx.bikes.map((b) => b.id)
  const usesBike = ['reading', 'correct_total', 'service'].includes(p.kind)
  const [bikeId, bikeChoices] = usesBike ? choice(p, 'bikeId', allBikes) : [s(p.bikeId), null]
  const [partId, partChoices] = p.kind === 'use_part' ? choice(p, 'partId', ctx.parts.map((x) => x.id)) : [s(p.partId), null]
  const [categoryId, categoryChoices] = p.kind === 'expense' ? choice(p, 'categoryId', ctx.categories.map((x) => x.id)) : ['', null]
  const d: Draft = {
    key: crypto.randomUUID(),
    kind: p.kind,
    clientId: crypto.randomUUID(),
    startClientId: crypto.randomUUID(),
    status: 'idle',
    error: '',
    bikeId,
    bikeChoices,
    itemIds: ids(p.itemIds),
    itemChoices: Array.isArray(p.itemCandidates) && ids(p.itemCandidates).length ? ids(p.itemCandidates) : null,
    partId,
    partChoices,
    categoryId,
    categoryChoices,
    hours: tenths(p.hoursTenths),
    km: whole(p.km),
    at: s(p.at) || ctx.today,
    by: p.by === 'garage' ? 'garage' : 'diy',
    garageName: s(p.garageName),
    notes: s(p.notes),
    partsUsed: (Array.isArray(p.partsUsed) ? p.partsUsed : []).map((l) => {
      const o = l as { partId?: unknown; qtyHundredths?: unknown }
      return { clientId: crypto.randomUUID(), partId: s(o.partId), qty: hundredths(o.qtyHundredths) || '1' }
    }),
    qty: hundredths(p.qtyHundredths) || (p.kind === 'add_part' ? '0' : '1'),
    name: s(p.name),
    unit: s(p.unit) || 'pcs',
    text: s(p.text),
    amount: euros(p.amountCents),
    description: s(p.description),
    title: s(p.title),
    dueOn: s(p.dueOn),
    repeatYearly: p.repeatYearly === true,
  }
  // A reading needs every meter the bike counts: the one not spoken starts at its last value.
  if ((p.kind === 'reading' || p.kind === 'correct_total') && bikeId) fillMeters(d, ctx)
  return d
}

/** Reading cards: fill a counted meter left empty with the bike's last reading. */
export function fillMeters(d: Draft, ctx: CardCtx) {
  const last = ctx.bikes.find((b) => b.id === d.bikeId)?.latestReading
  if (!d.hours && last?.hoursTenths != null) d.hours = tenths(last.hoursTenths)
  if (!d.km && last?.km != null) d.km = whole(last.km)
}

export const metersOf = (d: Draft, ctx: CardCtx): BikeMeters => ctx.bikes.find((b) => b.id === d.bikeId)?.meters ?? 'hours_km'

type Req = { url: string; body: Record<string, unknown>; method?: 'PATCH' } | { error: string }

function num(text: string, scale: number, min = 0): number | null | undefined {
  if (!text.trim()) return null
  const n = parseDecimal(text)
  return n === null || n < min ? undefined : Math.round(n * scale)
}

/** The existing route and body this card saves through, or why it can't be saved yet. */
export function requestFor(d: Draft, ctx: CardCtx): Req {
  const t = msgs().voiceCards
  const m = metersOf(d, ctx)
  const meter = (): { hoursTenths?: number; km?: number } | { error: string } => {
    const h = countsHours(m) ? num(d.hours, 10) : null
    const k = countsKm(m) ? num(d.km, 1) : null
    if (h === undefined) return { error: t.checkHours }
    if (k === undefined) return { error: t.checkKm }
    return { ...(h !== null ? { hoursTenths: h } : {}), ...(k !== null ? { km: k } : {}) }
  }
  const optBike = d.bikeId ? { bikeId: d.bikeId } : {}
  switch (d.kind) {
    case 'reading': {
      if (!d.bikeId) return { error: t.chooseBike }
      const mm = meter()
      if ('error' in mm) return mm
      if ((countsHours(m) && mm.hoursTenths === undefined) || (countsKm(m) && mm.km === undefined)) return { error: t.enterMeters }
      return { url: '/api/readings', body: { clientId: d.clientId, bikeId: d.bikeId, ...mm } }
    }
    case 'correct_total': {
      if (!d.bikeId) return { error: t.chooseBike }
      const mm = meter()
      if ('error' in mm) return mm
      if ((countsHours(m) && mm.hoursTenths === undefined) || (countsKm(m) && mm.km === undefined)) return { error: t.enterTotals }
      return { url: `/api/bikes/${d.bikeId}/latest-reading`, method: 'PATCH', body: mm }
    }
    case 'service': {
      if (!d.bikeId) return { error: t.chooseBike }
      if (!d.itemIds.length) return { error: t.chooseDone }
      if (!d.at) return { error: t.enterDate }
      const mm = meter()
      if ('error' in mm) return mm
      const parts = []
      for (const l of d.partsUsed) {
        const q = num(l.qty, 100, 0.01)
        if (!q) return { error: t.checkParts }
        parts.push({ clientId: l.clientId, partId: l.partId, qtyHundredths: q })
      }
      return {
        url: '/api/services',
        body: {
          clientId: d.clientId, bikeId: d.bikeId, at: d.at, itemIds: d.itemIds, ...mm, by: d.by,
          ...(d.by === 'garage' && d.garageName.trim() ? { garageName: d.garageName.trim() } : {}),
          ...(d.notes.trim() ? { notes: d.notes.trim() } : {}),
          ...(parts.length ? { partsUsed: parts } : {}),
        },
      }
    }
    case 'use_part': {
      if (!d.partId) return { error: t.choosePart }
      const q = num(d.qty, 100, 0.01)
      if (!q) return { error: t.checkQty }
      return { url: `/api/parts/${d.partId}/movements`, body: { clientId: d.clientId, qtyHundredths: -q, note: t.usedNote } }
    }
    case 'add_part': {
      if (!d.name.trim()) return { error: t.enterPartName }
      const q = num(d.qty, 100)
      if (q === undefined) return { error: t.checkQty }
      return { url: '/api/parts', body: { clientId: d.clientId, startClientId: d.startClientId, name: d.name.trim(), unit: d.unit.trim() || 'pcs', qtyHundredths: q ?? 0, ...optBike } }
    }
    case 'shopping':
      if (!d.text.trim()) return { error: t.enterToBuy }
      return { url: '/api/shopping', body: { clientId: d.clientId, text: d.text.trim(), ...optBike, ...(d.partId ? { partId: d.partId } : {}) } }
    case 'expense': {
      const c = num(d.amount, 100, 0.01)
      if (!c) return { error: t.enterAmount }
      if (!d.categoryId) return { error: t.chooseCategory }
      if (!d.at) return { error: t.enterDate }
      return { url: '/api/expenses', body: { clientId: d.clientId, at: d.at, amountCents: c, categoryId: d.categoryId, ...optBike, description: d.description.trim() } }
    }
    case 'reminder':
      if (!d.title.trim()) return { error: t.enterTitle }
      if (!d.dueOn) return { error: t.enterDate }
      return { url: '/api/reminders', body: { clientId: d.clientId, title: d.title.trim(), dueOn: d.dueOn, repeatYearly: d.repeatYearly, ...optBike } }
    default:
      return { error: t.unknown }
  }
}

/** Card heading per proposal kind, in the language in use. */
export const cardTitle = (kind: string): string => msgs().voiceCards.titles[kind] ?? kind
