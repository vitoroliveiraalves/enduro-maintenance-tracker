import { describe, it, expect } from 'vitest'
import { parseInvoiceQr, parseInvoiceQrResult } from '../../../app/lib/qr-invoice'

// The worked example from the AT technical specification (Portaria 195/2020).
const SAMPLE =
  'A:123456789*B:999999990*C:PT*D:FT*E:N*F:20191231*G:FT AB2019/0035*H:CSDF7T5H-0035*I1:PT*I2:12000.00*I3:15000.00*I4:900.00*I5:50000.00*I6:6500.00*I7:80000.00*I8:18400.00*N:25800.00*O:182800.00*P:0.00*Q:5uIg*R:9999'

describe('parseInvoiceQr', () => {
  it('parses header and totals', () => {
    expect(parseInvoiceQr(SAMPLE)).toMatchObject({
      supplierNif: '123456789',
      buyerNif: '999999990',
      type: 'FT',
      issuedAt: '2019-12-31',
      number: 'FT AB2019/0035',
      atcud: 'CSDF7T5H-0035',
      taxCents: 2_580_000,
      totalCents: 18_280_000,
    })
  })

  it('lists VAT bases per rate', () => {
    expect(parseInvoiceQr(SAMPLE)!.bases).toEqual([
      { rateLabel: 'Exempt', baseCents: 1_200_000, vatCents: 0 },
      { rateLabel: 'Reduced rate', baseCents: 1_500_000, vatCents: 90_000 },
      { rateLabel: 'Intermediate rate', baseCents: 5_000_000, vatCents: 650_000 },
      { rateLabel: 'Standard rate', baseCents: 8_000_000, vatCents: 1_840_000 },
    ])
  })

  it('labels the Azores fiscal space', () => {
    const qr = parseInvoiceQr(SAMPLE.replace('*N:', '*J1:PT-AC*J7:100.00*J8:16.00*N:'))!
    expect(qr.bases).toContainEqual({ rateLabel: 'Standard rate (Azores)', baseCents: 10_000, vatCents: 1_600 })
  })

  it('accepts credit notes and keeps a real buyer NIF', () => {
    const qr = parseInvoiceQr(SAMPLE.replace('B:999999990', 'B:501964843').replace('D:FT', 'D:NC'))!
    expect(qr).toMatchObject({ buyerNif: '501964843', type: 'NC' })
  })

  it('rejects non-invoice types with a reason', () => {
    for (const t of ['RC', 'PF', 'OR', 'GT']) {
      const r = parseInvoiceQrResult(SAMPLE.replace('D:FT', `D:${t}`))
      expect(r.qr).toBeNull()
      expect(r.reason).toMatch(/not an invoice/i)
      expect(parseInvoiceQr(SAMPLE.replace('D:FT', `D:${t}`))).toBeNull()
    }
  })

  it('treats garbled values as no QR', () => {
    expect(parseInvoiceQr(SAMPLE.replace('F:20191231', 'F:20261399'))).toBeNull()
    expect(parseInvoiceQr(SAMPLE.replace('F:20191231', 'F:20260230'))).toBeNull()
    expect(parseInvoiceQr(SAMPLE.replace('O:182800.00', 'O:99999999.99'))).toBeNull()
    expect(parseInvoiceQr(SAMPLE.replace('I7:80000.00', 'I7:-5.00'))).toBeNull()
    expect(parseInvoiceQr(SAMPLE.replace('A:123456789', 'A:12345'))).toBeNull()
    expect(parseInvoiceQr(SAMPLE.replace('G:FT AB2019/0035', `G:${'X'.repeat(80)}`))).toBeNull()
  })

  it('null for anything that is not a Portuguese invoice QR', () => {
    expect(parseInvoiceQr('https://example.com')).toBeNull()
    expect(parseInvoiceQr('')).toBeNull()
    expect(parseInvoiceQr('A:123*D:FT')).toBeNull()
    expect(parseInvoiceQr(SAMPLE.replace('F:20191231', 'F:31-12-2019'))).toBeNull()
  })
})
