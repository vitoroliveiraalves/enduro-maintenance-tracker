/** Parses a rider-typed number; accepts "142,5" and "142.5". Returns null when not a number. */
export function parseDecimal(input: string): number | null {
  // \s covers regular, no-break and thin spaces (thousands separators).
  const cleaned = input.replace(/\s/g, '').replace(',', '.')
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null
  return Number(cleaned)
}

/** "24,90" / "24.9" -> 2490 cents; null when not a positive amount up to 100 000 €. */
export function parseCents(input: string): number | null {
  const n = parseDecimal(input)
  if (n === null) return null
  const cents = Math.round(n * 100)
  return cents >= 1 && cents <= 10_000_000 ? cents : null
}

/** Today's local calendar day as YYYY-MM-DD. */
export function todayLocal(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
