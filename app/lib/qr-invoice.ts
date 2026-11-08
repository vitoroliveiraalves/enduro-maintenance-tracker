/**
 * Portuguese invoice QR code (Portaria n.º 195/2020) -> structured data.
 * The QR is "*"-separated "KEY:value" pairs: A issuer NIF, B buyer NIF,
 * D document type, F date (YYYYMMDD), G document id, H ATCUD, I/J/K fiscal
 * spaces (PT, PT-AC, PT-MA) with bases and VAT per rate, L not subject,
 * N total tax, O grand total.
 */

const INVOICE_TYPES = ['FT', 'FS', 'FR', 'NC', 'ND']

/** Upper bound for any QR amount: a bigger value means a garbled QR. */
export const MAX_QR_CENTS = 2_000_000_000

export type InvoiceQr = {
  supplierNif: string
  buyerNif: string | null
  type: string
  issuedAt: string // YYYY-MM-DD
  number: string
  atcud: string
  totalCents: number
  taxCents: number
  bases: Array<{ rateLabel: string; baseCents: number; vatCents: number }>
}

const cents = (v: string | undefined) => {
  if (!v) return 0
  const n = Number(v.replace(',', '.'))
  return Number.isFinite(n) ? Math.round(n * 100) : 0
}

function qrDate(f: string): string | null {
  if (!/^\d{8}$/.test(f)) return null
  const y = Number(f.slice(0, 4))
  const m = Number(f.slice(4, 6))
  const d = Number(f.slice(6, 8))
  const date = new Date(Date.UTC(y, m - 1, d))
  if (y < 2000 || date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null
  return `${f.slice(0, 4)}-${f.slice(4, 6)}-${f.slice(6, 8)}`
}

const SPACE_SUFFIX: Record<string, string> = { PT: '', 'PT-AC': ' (Azores)', 'PT-MA': ' (Madeira)' }

/** Parse and explain: `qr` is null when unusable; `reason` is set for a valid QR of a non-invoice document. */
export function parseInvoiceQrResult(text: string): { qr: InvoiceQr | null; reason?: string } {
  if (!text || !text.includes('*') || !text.startsWith('A:')) return { qr: null }
  const fields = new Map<string, string>()
  for (const part of text.split('*')) {
    const i = part.indexOf(':')
    if (i > 0) fields.set(part.slice(0, i).trim(), part.slice(i + 1).trim())
  }
  if (['A', 'D', 'F', 'G', 'H', 'O'].some((k) => !fields.get(k))) return { qr: null }

  const issuedAt = qrDate(fields.get('F')!)
  const number = fields.get('G')!
  const atcud = fields.get('H')!
  const supplierNif = fields.get('A')!
  if (!issuedAt || number.length > 60 || atcud.length > 70 || !/^\d{9}$/.test(supplierNif)) return { qr: null }

  const type = fields.get('D')!.toUpperCase()
  const totalCents = cents(fields.get('O'))
  const taxCents = cents(fields.get('N'))
  const amounts = [totalCents, taxCents, cents(fields.get('L'))]
  const bases: InvoiceQr['bases'] = []
  for (const p of ['I', 'J', 'K']) {
    const space = fields.get(`${p}1`)
    if (!space || space === '0') continue
    const suffix = SPACE_SUFFIX[space] ?? ` (${space})`
    const rows: Array<[string, string, string | null]> = [
      ['Exempt', `${p}2`, null],
      ['Reduced rate', `${p}3`, `${p}4`],
      ['Intermediate rate', `${p}5`, `${p}6`],
      ['Standard rate', `${p}7`, `${p}8`],
    ]
    for (const [label, bk, vk] of rows) {
      const baseCents = cents(fields.get(bk))
      const vatCents = vk ? cents(fields.get(vk)) : 0
      amounts.push(baseCents, vatCents)
      if (baseCents) bases.push({ rateLabel: label + suffix, baseCents, vatCents })
    }
  }
  const notSubject = cents(fields.get('L'))
  if (notSubject) bases.push({ rateLabel: 'Not subject to VAT', baseCents: notSubject, vatCents: 0 })
  if (amounts.some((a) => a < 0 || a > MAX_QR_CENTS)) return { qr: null }

  if (!INVOICE_TYPES.includes(type)) {
    return { qr: null, reason: `This QR code is not an invoice (document type ${type}).` }
  }
  const b = fields.get('B')
  return {
    qr: { supplierNif, buyerNif: b && /^\d{9}$/.test(b) ? b : null, type, issuedAt, number, atcud, totalCents, taxCents, bases },
  }
}

/** null when the text is not a Portuguese invoice QR (or is another document type, or garbled). */
export function parseInvoiceQr(text: string): InvoiceQr | null {
  return parseInvoiceQrResult(text).qr
}
