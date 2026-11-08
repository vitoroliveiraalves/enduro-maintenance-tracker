import { createError } from 'h3'

export const MAX_FILE_BYTES = 10 * 1024 * 1024
/** Whole request: one 10 MB PDF, or 5 downscaled photos, plus form overhead. */
export const MAX_REQUEST_BYTES = 12 * 1024 * 1024
export const MAX_PHOTOS = 5
/** files + qrRaw + slack */
export const MAX_PARTS = MAX_PHOTOS + 3
const IMAGE_MIMES = ['image/jpeg', 'image/png']

/** The file must be what it claims to be (a page served back inline must never be HTML). */
export function magicOk(mime: string, data: Uint8Array): boolean {
  const b = Buffer.from(data.subarray(0, 8))
  if (mime === 'application/pdf') return b.subarray(0, 5).toString('latin1') === '%PDF-'
  if (mime === 'image/jpeg') return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff
  if (mime === 'image/png') return b.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  return false
}

const bad = (statusCode: number, statusMessage: string) => createError({ statusCode, statusMessage })

/** Refuse oversized or length-less bodies before buffering them. */
export function assertContentLength(header: string | undefined) {
  const length = Number(header)
  if (!header || !Number.isFinite(length) || length <= 0) throw bad(411, 'Content-Length required')
  if (length > MAX_REQUEST_BYTES) throw bad(413, 'Files too large (10 MB max per invoice)')
}

export function validateUploadFiles(files: Array<{ type?: string; data: Uint8Array }>) {
  if (files.length === 0) throw bad(400, 'File missing')
  const pdfs = files.filter((f) => f.type === 'application/pdf')
  const images = files.filter((f) => IMAGE_MIMES.includes(f.type ?? ''))
  if (pdfs.length + images.length !== files.length) throw bad(400, 'Unsupported format — use PDF, JPEG or PNG.')
  if (pdfs.length > 1 || (pdfs.length === 1 && images.length > 0)) throw bad(400, 'Upload one PDF or up to 5 photos.')
  if (images.length > MAX_PHOTOS) throw bad(400, 'At most 5 photos per invoice.')
  if (files.some((f) => f.data.length > MAX_FILE_BYTES)) throw bad(413, 'File too large (10 MB max).')
  if (files.some((f) => !magicOk(f.type!, f.data))) throw bad(400, 'The file is not a valid PDF or image.')
}
