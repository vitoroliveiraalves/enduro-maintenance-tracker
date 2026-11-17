export type PdfTextSpan = {
  str: string
  /** [xMin, yMin, xMax, yMax] in PDF user-space coordinates */
  rect: [number, number, number, number]
}

export type PdfPageIndex = {
  page: number
  spans: PdfTextSpan[]
  fullText: string
  normText: string
  spanRanges: Array<[number, number]>
}

export type PdfSearchMatch = {
  index: number
  page: number
  snippetBefore: string
  snippetMatch: string
  snippetAfter: string
  rects: Array<[number, number, number, number]>
}

/** Strip diacritics and lowercase while keeping 1:1 character positions with NFC strings. */
export function normalisePdfText(s: string): string {
  return s
    .normalize('NFC')
    .replace(/\s+/g, ' ')
    .split('')
    .map((ch) => ch.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase())
    .join('')
}

/** Index a PDF page's text spans into searchable normalized text and span offsets. */
export function buildPageIndex(page: number, rawSpans: PdfTextSpan[]): PdfPageIndex {
  const spans: PdfTextSpan[] = []
  const fullParts: string[] = []
  const normParts: string[] = []
  const spanRanges: Array<[number, number]> = []
  let offset = 0

  for (const s of rawSpans) {
    const cleanFull = s.str.normalize('NFC').replace(/\s+/g, ' ').trim()
    if (!cleanFull) continue
    const cleanNorm = normalisePdfText(cleanFull)
    if (fullParts.length > 0) offset += 1
    const start = offset
    const end = start + cleanNorm.length
    spans.push({ str: cleanFull, rect: s.rect })
    fullParts.push(cleanFull)
    normParts.push(cleanNorm)
    spanRanges.push([start, end])
    offset = end
  }

  return {
    page,
    spans,
    fullText: fullParts.join(' '),
    normText: normParts.join(' '),
    spanRanges,
  }
}

/** Search all indexed PDF pages for a query, returning contextual snippets and span rects. */
export function searchPdfPages(pages: PdfPageIndex[], rawQuery: string): PdfSearchMatch[] {
  const q = normalisePdfText(rawQuery).trim()
  if (!q) return []

  const results: PdfSearchMatch[] = []
  for (const p of pages) {
    if (!p.normText) continue
    let pos = 0
    while (pos <= p.normText.length - q.length) {
      const idx = p.normText.indexOf(q, pos)
      if (idx === -1) break
      const matchStart = idx
      const matchEnd = idx + q.length

      const rects: Array<[number, number, number, number]> = []
      for (let i = 0; i < p.spanRanges.length; i++) {
        const [sStart, sEnd] = p.spanRanges[i]!
        if (sEnd > matchStart && sStart < matchEnd) {
          rects.push(p.spans[i]!.rect)
        }
      }

      const ctxStart = Math.max(0, matchStart - 30)
      const ctxEnd = Math.min(p.fullText.length, matchEnd + 40)
      const prefix = ctxStart > 0 ? '…' : ''
      const suffix = ctxEnd < p.fullText.length ? '…' : ''

      results.push({
        index: results.length,
        page: p.page,
        snippetBefore: prefix + p.fullText.slice(ctxStart, matchStart),
        snippetMatch: p.fullText.slice(matchStart, matchEnd),
        snippetAfter: p.fullText.slice(matchEnd, ctxEnd) + suffix,
        rects,
      })

      pos = idx + Math.max(1, q.length)
    }
  }
  return results
}

const UNIT_RE = /\b(\d+(?:[.,]\d+)?\s*(?:Nm|N·m|mm|cm|ml|L|bar|psi|kgf?\.?m|ft[-·]?lbs?|in[-·]?lbs?|kPa))\b/i

/** Pull a likely spec name + measurement/torque value out of a PDF search snippet. */
export function extractSpecCandidate(
  snippetBefore: string,
  snippetMatch: string,
  snippetAfter: string,
  query: string,
): { label: string; value: string } {
  const raw = `${snippetBefore}${snippetMatch}${snippetAfter}`.replace(/^…|…$/g, '').trim()
  const m = raw.match(UNIT_RE)
  if (m && m.index !== undefined) {
    const value = m[1]!.trim()
    const before = raw
      .slice(0, m.index)
      .replace(/\b(torque|capacity|gap|is|at|:|-)+\s*$/i, '')
      .trim()
    const label = (before || snippetMatch.trim() || query.trim() || 'Spec').slice(0, 80)
    return { label, value: value.slice(0, 120) }
  }
  return {
    label: (snippetMatch.trim() || query.trim() || 'Spec').slice(0, 80),
    value: raw.slice(0, 120),
  }
}

let pdfjsPromise: Promise<typeof import('pdfjs-dist')> | null = null
let workerBlobUrl: string | null = null

/** Load pdfjs-dist and cache its worker script in a Blob URL while online so offline viewing needs no network fetch. */
export async function loadPdfJs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import('pdfjs-dist').then(async (pdfjs) => {
      const assetUrl = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()
      if (!workerBlobUrl && typeof window !== 'undefined') {
        try {
          const res = await fetch(assetUrl)
          if (res.ok) {
            const blob = new Blob([await res.arrayBuffer()], { type: 'text/javascript' })
            workerBlobUrl = URL.createObjectURL(blob)
          }
        } catch {
          // Offline with active Service Worker: fall back to precached assetUrl
        }
      }
      pdfjs.GlobalWorkerOptions.workerSrc = workerBlobUrl ?? assetUrl
      return pdfjs
    })
  }
  return pdfjsPromise
}
