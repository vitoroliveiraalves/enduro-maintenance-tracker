/** Lowercase, accent-free, trimmed: "Óleo " -> "oleo". */
export function normalise(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}

/**
 * Every whitespace-separated word of the query appears in some field
 * (accents and case ignored). An empty query matches everything.
 */
export function matches(query: string, ...fields: Array<string | null | undefined>): boolean {
  const words = normalise(query).split(/\s+/).filter(Boolean)
  if (!words.length) return true
  const hay = fields.map((f) => normalise(f ?? ''))
  return words.every((w) => hay.some((f) => f.includes(w)))
}
