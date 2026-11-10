import { msgs } from '~/lib/i18n'
import { formatQty } from '~/lib/format'

export type PartUsedLine = { name: string; qtyHundredths: number; unit: string }
export type UseLine = { clientId: string; partId: string; qtyHundredths: number; partName: string }

/** "Parts: Oil filter, 1 L Motorex 10W-50"; one piece shows just the name. Sorted by name so the line is stable. */
export function partsLine(list: PartUsedLine[] | undefined): string {
  if (!list?.length) return ''
  const sorted = [...list].sort((a, b) => a.name.localeCompare(b.name, 'pt'))
  const one = (p: PartUsedLine) => (p.unit === 'pcs' && p.qtyHundredths === 100 ? p.name : `${formatQty(p.qtyHundredths, p.unit)} ${p.name}`)
  return msgs().parts.line(sorted.map(one).join(', '))
}

/** One line per part (the server rejects a repeated part): quantities add up, the first line's clientId stays. */
export function mergeUseLines(lines: UseLine[]): UseLine[] {
  const byPart = new Map<string, UseLine>()
  for (const l of lines) {
    const seen = byPart.get(l.partId)
    if (seen) seen.qtyHundredths += l.qtyHundredths
    else byPart.set(l.partId, { ...l })
  }
  return [...byPart.values()]
}

/** Part ids whose (merged) quantity is more than the shelf count: these need "Use anyway". */
export function overdrawn(lines: UseLine[], counts: Record<string, number>): string[] {
  return mergeUseLines(lines).filter((l) => l.qtyHundredths > (counts[l.partId] ?? 0)).map((l) => l.partId)
}
