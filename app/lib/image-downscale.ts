/**
 * Downscale a photo to `maxSide` px on its longest side and re-encode as JPEG.
 * Always re-encoded, never passed through: that strips EXIF (GPS, device) and
 * keeps five pages under the upload cap.
 */
export async function downscaleImage(file: Blob, maxSide = 2400, quality = 0.85): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode image'))), 'image/jpeg', quality),
  )
}
