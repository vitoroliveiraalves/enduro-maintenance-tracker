/** Parses a rider-typed number; accepts "142,5" and "142.5". Returns null when not a number. */
export function parseDecimal(input: string): number | null {
  // \s covers regular, no-break and thin spaces (thousands separators).
  const cleaned = input.replace(/\s/g, '').replace(',', '.')
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null
  return Number(cleaned)
}
