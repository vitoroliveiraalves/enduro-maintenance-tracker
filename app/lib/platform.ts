/** iPhone/iPod/iPad — iPadOS reports a desktop Mac UA, told apart by touch support. */
export function isIos(ua: string, maxTouchPoints: number): boolean {
  if (/iPad|iPhone|iPod/.test(ua)) return true
  return /Macintosh/.test(ua) && maxTouchPoints > 1
}

/** Running as an installed app (home-screen / standalone window). */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  const nav = navigator as Navigator & { standalone?: boolean }
  return nav.standalone === true || window.matchMedia?.('(display-mode: standalone)').matches === true
}

export function onIos(): boolean {
  return typeof navigator !== 'undefined' && isIos(navigator.userAgent, navigator.maxTouchPoints ?? 0)
}

/** VAPID public key (url-safe base64) → bytes for pushManager.subscribe. */
export function urlBase64ToUint8Array(b64: string): Uint8Array<ArrayBuffer> {
  const padded = (b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(padded)
  const out = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}
