// Generates tests/e2e/fixtures/invoice-qr.jpg: a white "invoice" page with a real PT fiscal QR.
// Run: node scripts/make-invoice-fixture.mjs   (output is committed)
import QRCode from 'qrcode'
import sharp from 'sharp'

export const FIXTURE_QR =
  'A:501964843*B:999999990*C:PT*D:FT*E:N*F:20260314*G:FT 2026A/0042*H:ABCD1234-42*I1:PT*I7:100.00*I8:23.00*N:23.00*O:123.00*Q:AbCd*R:1234'

const qr = await QRCode.toBuffer(FIXTURE_QR, { width: 700, margin: 2, errorCorrectionLevel: 'M' })
await sharp({ create: { width: 1200, height: 1600, channels: 3, background: '#ffffff' } })
  .composite([{ input: qr, top: 450, left: 250 }])
  .jpeg({ quality: 90 })
  .toFile('tests/e2e/fixtures/invoice-qr.jpg')
