/**
 * Suggest which maintenance items an invoice line resets, and which expense
 * category it belongs to. Pure (also used by the review page) and deliberately
 * conservative: a wrong suggestion resets an item, so unknown lines match nothing.
 * Tyres and labour never link an item — they are costs, not intervals.
 */
import type { categoryKinds } from '../db/schema'

export type LineKind = 'part' | 'labour' | 'fluid' | 'tyre' | 'other'
export type CategoryKind = (typeof categoryKinds)[number]

/** Lowercase, accents stripped: "Óleo travões" → "oleo travoes". */
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

// Oil words also appear in fork oil, brake fluid, coolant and 2T premix: those are not engine/gearbox oil.
const NOT_ENGINE_OIL = /suspens|forqueta|\bforks?\b|amortecedor|shock|trav(ao|oes)|brake|refrigera|coolant|\b2t\b|mistura/

/** [line keywords (PT/EN), item-name pattern, optional exclusion] */
const RULES: Array<[RegExp, RegExp, RegExp?]> = [
  [/\b(oleo|oil)\b/, /\boil\b/, NOT_ENGINE_OIL],
  [/filtro\s+(de\s+)?ar\b|air\s*filter/, /air\s*filter/],
  [/rolamento|bearing/, /bearing/],
  [/corrente|cremalheira|pinhao|\bchain|sprocket|kit\s+transmiss/, /chain|sprocket/],
  [/retentor|forqueta|\bforks?\b|suspens/, /\bfork/],
  [/amortecedor|\bshock|kit\s+suspens/, /\bshock/],
  [/\bvelas?\b|spark\s*plug/, /spark\s*plug/],
  [/pastilha|\bpads?\b/, /\bpads?\b/],
  [/liquido\s+(de\s+)?trav|brake\s*fluid|\bdot\s?[345]\b/, /brake\s*fluid/],
  [/pistao|piston/, /piston/],
  [/liquido\s+(de\s+)?refrigera|anticongelante|refrigerante|coolant/, /coolant/],
  [/valvula|valve/, /valve/],
]

export function matchLineToItems(description: string, items: Array<{ id: string; name: string }>): string[] {
  const d = norm(description)
  const patterns = RULES.filter(([line, , not]) => line.test(d) && !(not && not.test(d))).map(([, item]) => item)
  if (!patterns.length) return []
  return items.filter((i) => patterns.some((p) => p.test(norm(i.name)))).map((i) => i.id)
}

const UPGRADE = /protec|carter|bash\s*plate|skid\s*plate|handguard|guarda.?maos|escape|exhaust|ponteira|silenciador|silencer|steering\s*damper|amortecedor\s+de\s+direc|upgrade|footpeg|pousa.?pes|\bled\b/

export function defaultCategory(kind: LineKind, description: string): CategoryKind {
  if (kind === 'tyre') return 'tyres'
  if (kind === 'labour') return 'labour'
  if (kind === 'fluid') return 'oil'
  if (kind === 'part') return UPGRADE.test(norm(description)) ? 'upgrades' : 'maintenance'
  return 'other'
}
