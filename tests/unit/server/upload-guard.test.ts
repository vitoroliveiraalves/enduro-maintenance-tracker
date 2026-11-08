import { describe, it, expect } from 'vitest'
import { assertContentLength, validateUploadFiles, MAX_REQUEST_BYTES } from '../../../server/utils/upload-guard'

const jpeg = (n = 10) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(n)])
const png = () => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(4)])
const pdf = (n = 10) => Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(n)])
const file = (type: string, data: Buffer) => ({ type, data, filename: 'x' })
const status = (fn: () => unknown) => {
  try {
    fn()
  } catch (e) {
    return (e as { statusCode: number }).statusCode
  }
  return 200
}

describe('upload guard', () => {
  it('accepts up to 5 images or one PDF', () => {
    expect(status(() => validateUploadFiles([file('image/jpeg', jpeg()), file('image/png', png())]))).toBe(200)
    expect(status(() => validateUploadFiles([file('application/pdf', pdf())]))).toBe(200)
    expect(status(() => validateUploadFiles(Array.from({ length: 5 }, () => file('image/jpeg', jpeg()))))).toBe(200)
  })

  it('wrong magic bytes -> 400', () => {
    expect(status(() => validateUploadFiles([file('image/jpeg', Buffer.from('<html>nope</html>'))]))).toBe(400)
    expect(status(() => validateUploadFiles([file('application/pdf', jpeg())]))).toBe(400)
  })

  it('6 images -> 400', () => {
    expect(status(() => validateUploadFiles(Array.from({ length: 6 }, () => file('image/jpeg', jpeg()))))).toBe(400)
  })

  it('PDF of 11 MB -> 413', () => {
    expect(status(() => validateUploadFiles([file('application/pdf', pdf(11 * 1024 * 1024))]))).toBe(413)
  })

  it('unsupported type, mixed PDF+image, empty -> 400', () => {
    expect(status(() => validateUploadFiles([file('text/html', jpeg())]))).toBe(400)
    expect(status(() => validateUploadFiles([file('application/pdf', pdf()), file('image/jpeg', jpeg())]))).toBe(400)
    expect(status(() => validateUploadFiles([]))).toBe(400)
  })

  it('Content-Length required (411) and capped at 12 MB (413)', () => {
    expect(status(() => assertContentLength(undefined))).toBe(411)
    expect(status(() => assertContentLength('0'))).toBe(411)
    expect(status(() => assertContentLength('abc'))).toBe(411)
    expect(status(() => assertContentLength(String(MAX_REQUEST_BYTES + 1)))).toBe(413)
    expect(status(() => assertContentLength('1000'))).toBe(200)
  })
})
