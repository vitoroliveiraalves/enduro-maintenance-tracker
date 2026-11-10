/** Share-target hand-off: the service worker parks shared files in this cache, the Invoice screen picks them up. */
export const SHARE_PATH = '/share-target'
export const SHARE_CACHE = 'shared-invoice'
export const SHARE_MAX_FILES = 5
export const SHARE_TTL_MS = 60 * 60 * 1000
export const SHARE_ACCEPT = ['image/jpeg', 'image/png', 'application/pdf']

/** Keep what the invoice screen can read, at most 5 files. */
export function acceptShared<T extends { type: string }>(files: T[]): T[] {
  return files.filter((f) => SHARE_ACCEPT.includes(f.type)).slice(0, SHARE_MAX_FILES)
}

/** Shared files older than an hour are forgotten (a share the rider never finished, e.g. login in between). */
export const isFresh = (sharedAt: number, now = Date.now()) => now - sharedAt <= SHARE_TTL_MS

/** Take (and clear) the files the service worker parked. Empty when none, stale, or no Cache API. */
export async function takeShared(): Promise<File[]> {
  if (typeof caches === 'undefined') return []
  try {
    const cache = await caches.open(SHARE_CACHE)
    const keys = await cache.keys()
    const files: File[] = []
    for (const k of keys) {
      const res = await cache.match(k)
      await cache.delete(k)
      if (!res || !isFresh(Number(res.headers.get('X-Shared-At')))) continue
      const type = res.headers.get('Content-Type') ?? ''
      files.push(new File([await res.blob()], decodeURIComponent(res.headers.get('X-Name') ?? 'shared'), { type }))
    }
    return acceptShared(files)
  } catch {
    return []
  }
}
