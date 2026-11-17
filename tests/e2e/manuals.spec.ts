import { expect, test } from '@playwright/test'
import { bikeBody } from './helpers/seed'

function makeTextPdf(pages: string[]): Buffer {
  const objects: string[] = []
  const fontId = 3
  const pageIds: number[] = []
  let nextId = 4
  const bodyParts: Array<{ id: number; body: string }> = []

  for (const text of pages) {
    const escaped = text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
    const stream = `BT /F1 12 Tf 72 720 Td (${escaped}) Tj ET`
    const contentId = nextId++
    const pageId = nextId++
    pageIds.push(pageId)
    bodyParts.push({
      id: contentId,
      body: `${contentId} 0 obj\n<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream\nendobj\n`,
    })
    bodyParts.push({
      id: pageId,
      body: `${pageId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>\nendobj\n`,
    })
  }

  objects.push(`1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`)
  objects.push(`2 0 obj\n<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>\nendobj\n`)
  objects.push(`3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n`)
  for (const part of bodyParts.sort((a, b) => a.id - b.id)) objects.push(part.body)

  const header = '%PDF-1.4\n'
  const offsets: number[] = [0]
  let cursor = Buffer.byteLength(header, 'latin1')
  for (const obj of objects) {
    offsets.push(cursor)
    cursor += Buffer.byteLength(obj, 'latin1')
  }
  const xrefStart = cursor
  let xref = `xref\n0 ${offsets.length}\n0000000000 65535 f \n`
  for (let i = 1; i < offsets.length; i++) {
    xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`
  }
  const trailer = `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`
  return Buffer.from(header + objects.join('') + xref + trailer, 'latin1')
}

const SAMPLE_PDF = makeTextPdf([
  'Front axle nut torque 85 Nm and fork oil capacity 615 ml',
  'Spark plug gap 0.6 mm and rear axle nut torque 100 Nm',
])

test('save, view, download, and delete shop and user PDF manuals on a vehicle', async ({ page }) => {
  const user = { email: `manuals-${crypto.randomUUID()}@example.com`, password: 'enduro-pass-1', name: 'rider' }
  expect((await page.request.post('/api/auth/sign-up/email', { data: user })).ok()).toBeTruthy()
  const res = await page.request.post('/api/bikes', {
    data: bikeBody('300 EXC', [{ name: 'Oil', everyHoursTenths: 150 }]),
  })
  expect(res.ok()).toBeTruthy()
  const bike = (await res.json()) as { id: string }

  await page.goto(`/bikes/${bike.id}`)
  await expect(page.getByTestId('manuals-chip')).toBeVisible()
  await page.getByTestId('manuals-chip').click()

  await expect(page.getByTestId('manuals-sheet')).toBeVisible()
  await expect(page.getByTestId('manuals-empty')).toBeVisible()

  // 1. Upload a shop manual with custom title
  await page.getByTestId('manual-kind-shop').click()
  await page.getByTestId('manual-title-input').fill('300 EXC Workshop Manual')
  await page.getByTestId('manual-file-input').setInputFiles({
    name: 'workshop.pdf',
    mimeType: 'application/pdf',
    buffer: SAMPLE_PDF,
  })
  await page.getByTestId('manual-upload-submit').click()

  await expect(page.getByTestId('manual-row')).toHaveCount(1)
  await expect(page.getByTestId('manual-title').first()).toHaveText('300 EXC Workshop Manual')
  await expect(page.getByTestId('manual-kind-badge').first()).toHaveText(/Shop|Oficina/i)

  // 2. Upload a user manual without title (derived from filename)
  await page.getByTestId('manual-kind-user').click()
  await page.getByTestId('manual-file-input').setInputFiles({
    name: '2024-Owners-Manual.pdf',
    mimeType: 'application/pdf',
    buffer: SAMPLE_PDF,
  })
  await page.getByTestId('manual-upload-submit').click()

  await expect(page.getByTestId('manual-row')).toHaveCount(2)
  await expect(page.getByTestId('manual-title').first()).toHaveText('2024-Owners-Manual')
  await expect(page.getByTestId('manual-kind-badge').first()).toHaveText(/User|Utilizador/i)
  await expect(page.getByTestId('manuals-chip')).toContainText('(2)')

  // 3. Verify PDF file serving headers (inline & attachment)
  const openHref = await page.getByTestId('manual-open').first().getAttribute('href')
  expect(openHref).toBeTruthy()
  const inlineRes = await page.request.get(openHref!)
  expect(inlineRes.status()).toBe(200)
  expect(inlineRes.headers()['content-type']).toBe('application/pdf')
  expect(inlineRes.headers()['content-security-policy']).toBe('sandbox')
  expect(inlineRes.headers()['content-disposition']).toContain('inline;')
  expect((await inlineRes.body()).subarray(0, 5).toString('latin1')).toBe('%PDF-')

  const dlHref = await page.getByTestId('manual-download').first().getAttribute('href')
  const dlRes = await page.request.get(dlHref!)
  expect(dlRes.status()).toBe(200)
  expect(dlRes.headers()['content-disposition']).toContain('attachment;')

  // 3b. Open in-app searchable PDF viewer and search across pages
  await page.getByTestId('manual-open').first().click()
  await expect(page.getByTestId('pdf-doc-viewer')).toBeVisible()
  await expect(page.getByTestId('pdf-page-indicator')).toHaveText(/1 \/ 2/)

  await page.getByTestId('pdf-search-input').fill('Spark plug')
  await expect(page.getByTestId('pdf-search-count')).toHaveText('1 / 1')
  await expect(page.getByTestId('pdf-search-hit')).toHaveCount(1)
  await expect(page.getByTestId('pdf-search-hit')).toContainText(/2/)
  await expect(page.getByTestId('pdf-search-hit')).toContainText('Spark plug')
  await expect(page.getByTestId('pdf-page-indicator')).toHaveText(/2 \/ 2/)

  await page.getByTestId('pdf-search-input').fill('torque')
  await expect(page.getByTestId('pdf-search-count')).toHaveText('1 / 2')
  await expect(page.getByTestId('pdf-page-indicator')).toHaveText(/1 \/ 2/)
  await page.getByTestId('pdf-search-next').click()
  await expect(page.getByTestId('pdf-search-count')).toHaveText('2 / 2')
  await expect(page.getByTestId('pdf-page-indicator')).toHaveText(/2 \/ 2/)

  await page.getByTestId('manual-viewer-back').click()
  await expect(page.getByTestId('manuals-list')).toBeVisible()

  // 4. Reject invalid PDF via API
  const badRes = await page.request.post(`/api/bikes/${bike.id}/manuals`, {
    multipart: {
      clientId: crypto.randomUUID(),
      kind: 'shop',
      file: { name: 'fake.pdf', mimeType: 'application/pdf', buffer: Buffer.from('not a pdf') },
    },
  })
  expect(badRes.status()).toBe(400)

  // 5. Delete one manual via UI
  await page.getByTestId('manual-delete').first().click()
  await page.getByTestId('manual-delete-confirm').click()
  await expect(page.getByTestId('manual-row')).toHaveCount(1)
  await expect(page.getByTestId('manuals-chip')).toContainText('(1)')

  // 6. Verify Manuals card in vehicle settings
  await page.goto(`/bikes/${bike.id}/settings`)
  await expect(page.getByTestId('manuals-settings-card')).toContainText(/1 manual/i)
  await page.getByTestId('open-manuals-sheet').click()
  await expect(page.getByTestId('manuals-sheet')).toBeVisible()
  await expect(page.getByTestId('manual-row')).toHaveCount(1)
})
