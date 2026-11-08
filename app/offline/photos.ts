import { getDb, notifyOutbox, type PendingPhoto } from './db'

/**
 * Invoice photos captured offline (Ruling R12): kept on this phone and
 * uploaded by the next flush with the same clientId (the server dedupes on it,
 * and on the photo bytes), then read.
 */
export async function queuePhotos(p: { files: Blob[]; qrRaw?: string | null; userId: string }): Promise<PendingPhoto> {
  const files = await Promise.all(
    p.files.map(async (f, i) => ({
      data: await f.arrayBuffer(),
      type: f.type || 'image/jpeg',
      name: f.type === 'application/pdf' ? 'invoice.pdf' : `page-${i + 1}.jpg`,
    })),
  )
  const row: PendingPhoto = {
    clientId: crypto.randomUUID(),
    userId: p.userId,
    files,
    ...(p.qrRaw ? { qrRaw: p.qrRaw } : {}),
    createdAt: Date.now(),
    attempts: 0,
  }
  row.id = await getDb().pendingPhotos.add(row)
  notifyOutbox()
  return row
}

export async function listPhotos(): Promise<PendingPhoto[]> {
  try {
    return await getDb().pendingPhotos.orderBy('id').toArray()
  } catch {
    return []
  }
}

export async function removePhoto(id: number): Promise<void> {
  await getDb().pendingPhotos.delete(id)
  notifyOutbox()
}

/** The same multipart body the online upload sends. */
export function photoForm(p: PendingPhoto): FormData {
  const form = new FormData()
  for (const f of p.files) form.append('files', new Blob([f.data], { type: f.type }), f.name)
  if (p.qrRaw) form.append('qrRaw', p.qrRaw)
  form.append('clientId', p.clientId)
  return form
}
