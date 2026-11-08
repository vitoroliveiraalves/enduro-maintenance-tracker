/**
 * Decode the Portuguese invoice QR in the browser: photos directly, a PDF via
 * its first page rendered with pdf.js. Heavy libraries load on demand and
 * decoding is best-effort — a missing QR never blocks an upload.
 */
async function detectQr(source: ImageBitmapSource): Promise<string | null> {
  const [{ BarcodeDetector, setZXingModuleOverrides }, { zxingOverrides }] = await Promise.all([
    import('barcode-detector/pure'),
    import('~/lib/zxing-wasm'),
  ])
  setZXingModuleOverrides(zxingOverrides)
  const detector = new BarcodeDetector({ formats: ['qr_code'] })
  const found = await detector.detect(source)
  // The fiscal QR is the one that starts with the issuer NIF field.
  return found.map((b) => b.rawValue).find((v) => v.startsWith('A:')) ?? null
}

async function pdfFirstPage(file: Blob): Promise<HTMLCanvasElement> {
  const pdfjs = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise
  const page = await doc.getPage(1)
  const viewport = page.getViewport({ scale: 2 }) // small QR codes need the resolution
  const canvas = document.createElement('canvas')
  canvas.width = viewport.width
  canvas.height = viewport.height
  await page.render({ canvasContext: canvas.getContext('2d')!, viewport }).promise
  return canvas
}

export function useQrScan() {
  /** Raw QR text from the first page that has one, or null. */
  async function scan(files: Blob[]): Promise<string | null> {
    try {
      const first = files[0]
      if (!first) return null
      if (first.type === 'application/pdf') return await detectQr(await pdfFirstPage(first))
      for (const f of files) {
        const text = await detectQr(await createImageBitmap(f))
        if (text) return text
      }
    } catch {
      // best-effort
    }
    return null
  }
  return { scan }
}
