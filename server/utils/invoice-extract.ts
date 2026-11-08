/**
 * Reading a garage invoice with a vision model through OpenRouter. Ported from
 * encomentio's fatura-extract (request shape, strict JSON schema, euros → cents,
 * row-tolerant parsing, header validation, usage/cost) and cut down to what a
 * rider needs: header + lines with the amount actually paid (VAT included).
 * The QR code is read on the phone and is ground truth; the model only fills gaps.
 *
 * Pure apart from the injected `fetch` — the unit tests mock it. Never throws:
 * every failure is `{ ok: false }` and the rider types the lines (Review Focus 4).
 */

export type ExtractDoc = { mime: string; bytes: Buffer }

export const LINE_KINDS = ['part', 'labour', 'fluid', 'tyre', 'other'] as const
export type LineKind = (typeof LINE_KINDS)[number]

export type InvoiceLine = {
  description: string
  qty?: number
  /** Null when the price isn't printed or readable — never guessed. */
  unitCents?: number | null
  totalCents: number | null
  kind: LineKind
}

export type InvoiceData = {
  supplierName?: string
  supplierNif?: string
  number?: string
  issuedAt?: string
  totalCents?: number
  lines: InvoiceLine[]
}

export type ExtractMeta = { model: string; usage?: unknown }
export type ExtractOutcome = { ok: true; data: InvoiceData; meta?: ExtractMeta } | { ok: false; error: string; meta?: ExtractMeta }

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'
/** One call, well inside the 120 s stuck-read window. */
const TIMEOUT_MS = 90_000

const numOrNull = { type: ['number', 'null'] } as const
const strOrNull = { type: ['string', 'null'] } as const

// Euros as plain numbers (models are reliable with decimals); cents on our side.
const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['readable', 'supplierName', 'supplierNif', 'number', 'issuedAt', 'pricesIncludeVat', 'total', 'lines'],
  properties: {
    readable: { type: 'boolean', description: 'false if the photo is blurred, cut off or not an invoice/receipt' },
    supplierName: { ...strOrNull, description: 'Issuer (the garage/shop) name' },
    supplierNif: { ...strOrNull, description: "Issuer's Portuguese NIF, 9 digits" },
    number: { ...strOrNull, description: 'Document number exactly as printed, e.g. "FT 2026A/0042"' },
    issuedAt: { ...strOrNull, description: 'Issue date, YYYY-MM-DD' },
    pricesIncludeVat: { type: 'boolean', description: 'true if the line prices printed already include VAT (IVA)' },
    total: { ...numOrNull, description: 'Grand total paid, including VAT, in euros' },
    lines: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['description', 'kind', 'qty', 'unitPrice', 'lineTotal', 'vatRate'],
        properties: {
          description: { type: 'string', description: 'Line text exactly as printed' },
          kind: {
            type: 'string',
            enum: LINE_KINDS,
            description: 'tyre = tyres, inner tubes, mousses; labour = mão de obra / workshop hours; fluid = oils, brake fluid, coolant; part = any other part; other = fees, discounts, anything else',
          },
          qty: { ...numOrNull, description: 'Quantity as printed' },
          unitPrice: { ...numOrNull, description: 'Unit price as printed, in euros; null if not printed' },
          lineTotal: { ...numOrNull, description: 'Line total as printed, in euros; null if not printed' },
          vatRate: { ...numOrNull, description: 'VAT rate of the line as a percentage (6, 13, 23…)' },
        },
      },
    },
  },
} as const

const PROMPT = `You read Portuguese garage and motorbike-shop invoices (faturas, faturas-recibo, talões). Return the data in the requested format.
Rules:
- Go through the item table row by row, top to bottom. Every printed row with a description and an amount must appear in "lines", in the same order. Never merge two rows; never copy a value from a neighbouring row.
- "description": the row text exactly as printed, in its original language (do not translate), with sizes as printed (e.g. 140/80-18).
- "kind": tyre for tyres/tubes/mousses; labour for "mão de obra" and workshop time; fluid for oils, brake fluid, coolant; part for other parts; other for fees and adjustments.
- Amounts in euros with a decimal point ("1.234,50" → 1234.5). Copy them as printed; do not convert them.
- "pricesIncludeVat": true when the printed line prices already include IVA (typical on a simplified invoice / talão), false when they are net and IVA is added in the totals.
- "total": the grand total the customer paid, with IVA.
- "supplierName"/"supplierNif": who ISSUED the invoice (the garage), not the customer. A NIF under "Contribuinte do cliente" is the customer's.
- If a value is missing or unreadable use null. Never invent rows or prices. If the image is not a readable invoice, readable = false.`

const MAX_CENTS = 10_000_000 // matches the expense cap (100 000 €)
const MAX_LINES = 50 // matches confirm
const toCents = (eur: number | null) => {
  if (eur == null || !Number.isFinite(eur)) return null
  const c = Math.round(eur * 100)
  return Math.abs(c) > MAX_CENTS ? null : c
}

/** The model's date only if it's a real calendar date (YYYY-MM-DD). */
function realDate(v: string | null): string | undefined {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return undefined
  const [y, m, d] = v.split('-').map(Number)
  const date = new Date(Date.UTC(y!, m! - 1, d!))
  return y! >= 2000 && y! <= 2100 && date.getUTCMonth() === m! - 1 && date.getUTCDate() === d! ? v : undefined
}

export function buildRequest(docs: ExtractDoc[], model: string) {
  const parts: unknown[] = []
  docs.forEach((d, i) => {
    const data = `data:${d.mime};base64,${d.bytes.toString('base64')}`
    if (d.mime === 'application/pdf') parts.push({ type: 'file', file: { filename: `invoice-${i + 1}.pdf`, file_data: data } })
    else parts.push({ type: 'image_url', image_url: { url: data } })
  })
  parts.push({ type: 'text', text: PROMPT })
  return {
    model,
    messages: [{ role: 'user', content: parts }],
    response_format: { type: 'json_schema', json_schema: { name: 'invoice', strict: true, schema: SCHEMA } },
    provider: { require_parameters: true },
    // OpenRouter returns token usage and cost only when asked; kept with the read.
    usage: { include: true },
    temperature: 0,
  }
}

/**
 * Model JSON (euros) → our shape (cents, VAT included). Throws only when there
 * is no lines array; a row without a description is dropped, a bad header value
 * is left out, an unreadable price stays null — one smudge never sinks the read.
 */
export function parseExtraction(raw: unknown): InvoiceData & { readable: boolean } {
  const o = raw as Record<string, unknown>
  if (!o || typeof o !== 'object' || !Array.isArray(o.lines)) throw new Error('no lines')
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  const addVat = o.pricesIncludeVat === false
  const lines: InvoiceLine[] = []
  for (const l of o.lines as Array<Record<string, unknown> | null>) {
    if (lines.length >= MAX_LINES) break
    if (!l || typeof l !== 'object') continue
    const description = str(l.description)
    if (!description) continue
    const qtyRaw = num(l.qty)
    const qty = qtyRaw != null && qtyRaw > 0 && qtyRaw <= 10_000 ? qtyRaw : undefined
    const rate = num(l.vatRate)
    const gross = (eur: number | null) => (eur != null && addVat && rate != null && rate >= 0 && rate <= 30 ? eur * (1 + rate / 100) : eur)
    const unitCents = toCents(gross(num(l.unitPrice)))
    let totalCents = toCents(gross(num(l.lineTotal)))
    if (totalCents == null && unitCents != null) totalCents = toCents((unitCents * (qty ?? 1)) / 100)
    const kind = (LINE_KINDS as readonly string[]).includes(l.kind as string) ? (l.kind as LineKind) : 'other'
    lines.push({ description: description.slice(0, 200), kind, ...(qty != null ? { qty } : {}), unitCents, totalCents })
  }
  const nif = str(o.supplierNif)?.replace(/\D/g, '')
  const total = toCents(num(o.total))
  const out: InvoiceData & { readable: boolean } = { readable: o.readable !== false, lines }
  const name = str(o.supplierName)
  if (name) out.supplierName = name.slice(0, 80)
  if (nif && /^\d{9}$/.test(nif)) out.supplierNif = nif
  const number = str(o.number)
  if (number) out.number = number.slice(0, 60)
  const issuedAt = realDate(str(o.issuedAt))
  if (issuedAt) out.issuedAt = issuedAt
  if (total != null && total > 0) out.totalCents = total
  return out
}

export async function extractInvoice(
  docs: ExtractDoc[],
  cfg: { apiKey: string; model: string },
  fetchImpl: typeof fetch = fetch,
  opts: { timeoutMs?: number } = {},
): Promise<ExtractOutcome> {
  if (!cfg.apiKey) return { ok: false, error: 'no_key' }
  const meta: ExtractMeta = { model: cfg.model }
  let res: Response
  try {
    res = await fetchImpl(OPENROUTER_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json', 'X-Title': 'Enduro Tracker' },
      body: JSON.stringify(buildRequest(docs, cfg.model)),
      signal: AbortSignal.timeout(opts.timeoutMs ?? TIMEOUT_MS),
    })
  } catch (err) {
    const name = (err as Error | undefined)?.name
    return { ok: false, error: name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network', meta }
  }
  if (!res.ok) return { ok: false, error: `http_${res.status}`, meta }

  let body: { choices?: Array<{ message?: { content?: string | null; refusal?: string | null } }>; usage?: unknown } | null
  try {
    body = await res.json()
  } catch {
    return { ok: false, error: 'invalid_response', meta }
  }
  const withUsage = { ...meta, usage: body?.usage }
  const message = body?.choices?.[0]?.message
  if (!message?.content || message.refusal) return { ok: false, error: 'refused', meta: withUsage }
  try {
    const { readable, ...data } = parseExtraction(JSON.parse(message.content))
    if (!readable) return { ok: false, error: 'unreadable', meta: withUsage }
    return { ok: true, data, meta: withUsage }
  } catch {
    return { ok: false, error: 'invalid_json', meta: withUsage }
  }
}

/** A short reason shown under the manual-entry notice. */
export function readErrorMessage(error: string): string {
  if (error === 'no_key') return 'Automatic reading is not set up on this server.'
  if (error === 'unreadable') return 'The photo looks blurred or cut off.'
  if (error === 'timeout') return 'Reading took too long.'
  if (error === 'no_lines') return 'No invoice lines were found.'
  return 'The reading service did not answer properly.'
}
