// Generates the invoice fixtures under tests/e2e/fixtures (output is committed):
//  - invoice-qr.jpg      a white "invoice" page with a real PT fiscal QR (total 123,00)
//  - invoice-garage.jpg  a garage invoice whose QR total (215,40) matches the mock reader's 3 lines
//  - receipt-rc.jpg      a receipt (document type RC): a valid QR that is not an invoice
//  - invoice-mock-fail.pdf  a PDF carrying the MOCK-FAIL marker: the e2e mock reader fails on it
// Run: node scripts/make-invoice-fixture.mjs
import { writeFileSync } from 'node:fs'
import QRCode from 'qrcode'
import sharp from 'sharp'

export const FIXTURE_QR =
  'A:501964843*B:999999990*C:PT*D:FT*E:N*F:20260314*G:FT 2026A/0042*H:ABCD1234-42*I1:PT*I7:100.00*I8:23.00*N:23.00*O:123.00*Q:AbCd*R:1234'
export const GARAGE_QR =
  'A:509876543*B:999999990*C:PT*D:FT*E:N*F:20261102*G:FT 2026B/0117*H:WXYZ9876-117*I1:PT*I7:175.12*I8:40.28*N:40.28*O:215.40*Q:EfGh*R:1234'
export const RECEIPT_QR =
  'A:509876543*B:999999990*C:PT*D:RC*E:N*F:20261102*G:RC 2026B/0007*H:WXYZ9876-7*I1:PT*N:0.00*O:50.00*Q:EfGh*R:1234'

async function page(file, qrText, lines) {
  const qr = await QRCode.toBuffer(qrText, { width: 420, margin: 2, errorCorrectionLevel: 'M' })
  // each line: "left" or ["left", "amount"] (amount right-aligned)
  const text = lines
    .map((l, i) => {
      const [left, right] = Array.isArray(l) ? l : [l, '']
      const attrs = `y="${150 + i * 56}" font-family="Helvetica, Arial" font-size="${i === 0 ? 46 : 34}" fill="#222"`
      return `<text x="80" ${attrs}>${left}</text>` + (right ? `<text x="1120" text-anchor="end" ${attrs}>${right}</text>` : '')
    })
    .join('')
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1600">${text}</svg>`)
  await sharp({ create: { width: 1200, height: 1600, channels: 3, background: '#ffffff' } })
    .composite([{ input: svg, top: 0, left: 0 }, { input: qr, top: 1080, left: 700 }])
    .jpeg({ quality: 90 })
    .toFile(file)
}

const qr = await QRCode.toBuffer(FIXTURE_QR, { width: 700, margin: 2, errorCorrectionLevel: 'M' })
await sharp({ create: { width: 1200, height: 1600, channels: 3, background: '#ffffff' } })
  .composite([{ input: qr, top: 450, left: 250 }])
  .jpeg({ quality: 90 })
  .toFile('tests/e2e/fixtures/invoice-qr.jpg')

await page('tests/e2e/fixtures/invoice-garage.jpg', GARAGE_QR, [
  'Moto Garage Braga, Lda',
  'NIF 509876543 · Fatura FT 2026B/0117 · 2026-11-02',
  '',
  ['Pneu Michelin Enduro Medium 140/80-18', '129,00'],
  ['Mão de obra', '30,00'],
  ['Rolamentos roda traseira', '56,40'],
  '',
  ['Total (IVA incluído)', '215,40 €'],
])
await page('tests/e2e/fixtures/receipt-rc.jpg', RECEIPT_QR, ['Moto Garage Braga, Lda', 'Recibo RC 2026B/0007', '', ['Valor recebido', '50,00 €']])

// A one-page PDF by hand (no extra dependency); xref offsets computed.
const content = 'BT /F1 24 Tf 72 720 Td (Garage invoice MOCK-FAIL) Tj ET'
const objs = [
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
  `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
]
let pdf = '%PDF-1.4\n'
const offsets = objs.map((o, i) => {
  const at = pdf.length
  pdf += `${i + 1} 0 obj\n${o}\nendobj\n`
  return at
})
const xref = pdf.length
pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`
pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
writeFileSync('tests/e2e/fixtures/invoice-mock-fail.pdf', pdf, 'latin1')
