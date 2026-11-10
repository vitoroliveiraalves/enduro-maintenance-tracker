import { countsHours, countsKm, type BikeMeters } from '../../shared/utils/meters'
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '../db/client'
import { bikes, categories, maintenanceItems, parts } from '../db/schema'
import { isObj, str, type Obj } from './bikes'
import { amountCents, description } from './expenses'
import { bad, day, int, isUuid } from './validate'

/** Either one id or, when the model was unsure, owned candidate ids (empty → the card offers every option). */
type Pick1<K extends string> = { [P in K]: string } | { candidates: string[] }
type Meters = { hoursTenths?: number; km?: number }

export type Proposal =
  | ({ kind: 'reading' } & Pick1<'bikeId'> & Meters)
  | ({ kind: 'correct_total' } & Pick1<'bikeId'> & Meters)
  | ({
      kind: 'service'
      at: string
      by: 'diy' | 'garage'
      garageName?: string
      notes?: string
      partsUsed?: Array<{ partId: string; qtyHundredths: number }>
    } & Pick1<'bikeId'> & ({ itemIds: string[] } | { itemCandidates: string[] }) & Meters)
  | ({ kind: 'use_part'; qtyHundredths: number } & Pick1<'partId'>)
  | { kind: 'add_part'; name: string; unit: string; qtyHundredths: number; bikeId?: string }
  | { kind: 'shopping'; text: string; bikeId?: string; partId?: string }
  | ({ kind: 'expense'; amountCents: number; at: string; description: string; bikeId?: string } & Pick1<'categoryId'>)
  | { kind: 'reminder'; title: string; dueOn: string; repeatYearly: boolean; bikeId?: string }

export const MAX_PROPOSALS = 10
const QTY_MAX = 10_000_000

type Owned = {
  bikes: Map<string, BikeMeters>
  items: Map<string, string> // itemId → bikeId
  parts: Set<string>
  categories: Set<string>
}

async function ownedSets(userId: string): Promise<Owned> {
  const [b, i, p, c] = await Promise.all([
    db.select({ id: bikes.id, meters: bikes.meters }).from(bikes).where(and(eq(bikes.userId, userId), isNull(bikes.archivedAt))),
    db.select({ id: maintenanceItems.id, bikeId: maintenanceItems.bikeId }).from(maintenanceItems)
      .where(and(eq(maintenanceItems.userId, userId), isNull(maintenanceItems.archivedAt))),
    db.select({ id: parts.id }).from(parts).where(eq(parts.userId, userId)),
    db.select({ id: categories.id }).from(categories).where(eq(categories.userId, userId)),
  ])
  return {
    bikes: new Map(b.map((x) => [x.id, x.meters])),
    items: new Map(i.map((x) => [x.id, x.bikeId])),
    parts: new Set(p.map((x) => x.id)),
    categories: new Set(c.map((x) => x.id)),
  }
}

const ids = (v: unknown): string[] => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => isUuid(x)))].slice(0, 20) : [])

/** `{ [key]: id }` when the single id is owned, else the owned candidates (possibly none). */
function pick<K extends string>(o: Obj, key: K, owns: (id: string) => boolean): Pick1<K> {
  if (isUuid(o[key]) && owns(o[key] as string)) return { [key]: o[key] } as Pick1<K>
  return { candidates: ids(o.candidates).filter(owns) }
}

/** An optional owned id: a foreign or malformed one is dropped, never kept. */
function optId<K extends string>(o: Obj, key: K, owns: (id: string) => boolean): Partial<Record<K, string>> {
  return isUuid(o[key]) && owns(o[key] as string) ? ({ [key]: o[key] } as Record<K, string>) : {}
}

/** Meter values, only for meters the bike counts (an unresolved bike keeps both for the card to filter). */
function meters(o: Obj, m: BikeMeters | undefined): Meters {
  const out: Meters = {}
  if (o.hoursTenths != null && (!m || countsHours(m))) out.hoursTenths = int(o.hoursTenths, 'hoursTenths')
  if (o.km != null && (!m || countsKm(m))) out.km = int(o.km, 'km')
  return out
}

const optStr = (v: unknown, field: string, max: number) => (v == null || v === '' ? {} : { [field]: str(v, field, max) })

function one(o: Obj, own: Owned): Proposal {
  const ownsBike = (id: string) => own.bikes.has(id)
  const ownsPart = (id: string) => own.parts.has(id)
  switch (o.kind) {
    case 'reading': {
      const b = pick(o, 'bikeId', ownsBike)
      const m = meters(o, 'bikeId' in b ? own.bikes.get(b.bikeId) : undefined)
      if (m.hoursTenths === undefined && m.km === undefined) throw bad('no meter value')
      return { kind: 'reading', ...b, ...m }
    }
    case 'correct_total': {
      const b = pick(o, 'bikeId', ownsBike)
      const m = meters(o, 'bikeId' in b ? own.bikes.get(b.bikeId) : undefined)
      if (m.hoursTenths === undefined && m.km === undefined) throw bad('no meter value')
      return { kind: 'correct_total', ...b, ...m }
    }
    case 'service': {
      const b = pick(o, 'bikeId', ownsBike)
      const bikeId = 'bikeId' in b ? b.bikeId : null
      const ownsItem = (id: string) => own.items.has(id) && (!bikeId || own.items.get(id) === bikeId)
      const itemIds = ids(o.itemIds).filter(ownsItem)
      const items = itemIds.length ? { itemIds } : { itemCandidates: ids(o.itemCandidates).filter(ownsItem) }
      if (o.by !== undefined && o.by !== 'diy' && o.by !== 'garage') throw bad('Invalid by')
      let partsUsed: Array<{ partId: string; qtyHundredths: number }> | undefined
      if (o.partsUsed !== undefined) {
        if (!Array.isArray(o.partsUsed) || o.partsUsed.length > 20) throw bad('Invalid partsUsed')
        partsUsed = o.partsUsed
          .filter((l): l is Obj => isObj(l) && isUuid(l.partId) && ownsPart(l.partId as string))
          .map((l) => ({ partId: l.partId as string, qtyHundredths: int(l.qtyHundredths, 'partsUsed qtyHundredths', 1, QTY_MAX) }))
        if (new Set(partsUsed.map((l) => l.partId)).size !== partsUsed.length) throw bad('Duplicate partsUsed line')
      }
      return {
        kind: 'service', ...b, ...items, at: day(o.at), by: o.by === 'garage' ? 'garage' : 'diy',
        ...meters(o, bikeId ? own.bikes.get(bikeId) : undefined),
        ...(o.by === 'garage' ? optStr(o.garageName, 'garageName', 80) : {}),
        ...optStr(o.notes, 'notes', 500),
        ...(partsUsed?.length ? { partsUsed } : {}),
      }
    }
    case 'use_part':
      return { kind: 'use_part', ...pick(o, 'partId', ownsPart), qtyHundredths: int(o.qtyHundredths, 'qtyHundredths', 1, QTY_MAX) }
    case 'add_part':
      return {
        kind: 'add_part', name: str(o.name, 'name', 80), unit: o.unit == null || o.unit === '' ? 'pcs' : str(o.unit, 'unit', 12),
        qtyHundredths: o.qtyHundredths == null ? 0 : int(o.qtyHundredths, 'qtyHundredths', 0, QTY_MAX), ...optId(o, 'bikeId', ownsBike),
      }
    case 'shopping':
      return { kind: 'shopping', text: str(o.text, 'text', 120), ...optId(o, 'bikeId', ownsBike), ...optId(o, 'partId', ownsPart) }
    case 'expense':
      return {
        kind: 'expense', amountCents: amountCents(o.amountCents), ...pick(o, 'categoryId', (id) => own.categories.has(id)),
        at: day(o.at), description: description(o.description), ...optId(o, 'bikeId', ownsBike),
      }
    case 'reminder':
      if (o.repeatYearly !== undefined && typeof o.repeatYearly !== 'boolean') throw bad('Invalid repeatYearly')
      return { kind: 'reminder', title: str(o.title, 'title'), dueOn: day(o.dueOn, 'dueOn'), repeatYearly: o.repeatYearly === true, ...optId(o, 'bikeId', ownsBike) }
    default:
      throw bad('unknown kind')
  }
}

const label = (o: unknown) => (isObj(o) && typeof o.kind === 'string' ? o.kind.slice(0, 20).replace('_', ' ') : 'a change')

/**
 * Checks every proposal the model made against the same rules as the real routes and the
 * rider's own ids. Foreign ids are dropped; an invalid proposal is left out with a note.
 */
export async function validateProposals(userId: string, raw: unknown): Promise<{ proposals: Proposal[]; notes: string[] }> {
  const list = Array.isArray(raw) ? raw.slice(0, MAX_PROPOSALS) : []
  if (!list.length) return { proposals: [], notes: [] }
  const own = await ownedSets(userId)
  const proposals: Proposal[] = []
  const notes: string[] = []
  for (const o of list) {
    try {
      if (!isObj(o)) throw bad('not an object')
      proposals.push(one(o, own))
    } catch (e) {
      if ((e as { statusCode?: number }).statusCode !== 400) throw e
      notes.push(`Couldn't understand: ${label(o)} (${(e as { statusMessage?: string }).statusMessage ?? 'invalid'})`)
    }
  }
  return { proposals, notes }
}
