// Service worker (built by @vite-pwa/nuxt, strategies: 'injectManifest').
// Precache + SPA navigation fallback, as the generated worker did, plus Web Push.
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'
import { clientsClaim } from 'workbox-core'
import { acceptShared, SHARE_CACHE, SHARE_PATH } from './lib/share-target'

// Minimal worker types: the app tsconfig uses the DOM lib, not WebWorker.
type ExtendableEvent = Event & { waitUntil(p: Promise<unknown>): void }
type PushEvent = ExtendableEvent & { data: { json(): unknown; text(): string } | null }
type FetchEvent = ExtendableEvent & { request: Request; respondWith(r: Promise<Response>): void }
type NotificationEvent = ExtendableEvent & { notification: Notification & { data?: unknown; close(): void } }
type WindowClient = { url: string; focus(): Promise<WindowClient>; navigate(url: string): Promise<WindowClient | null> }
type SwScope = {
  __WB_MANIFEST: Array<{ url: string; revision: string | null } | string>
  location: Location
  registration: { showNotification(title: string, options?: NotificationOptions & { data?: unknown }): Promise<void> }
  clients: { matchAll(o: { type: 'window'; includeUncontrolled: boolean }): Promise<WindowClient[]>; openWindow(url: string): Promise<WindowClient | null> }
  skipWaiting(): Promise<void>
  addEventListener(type: 'push', fn: (e: PushEvent) => void): void
  addEventListener(type: 'fetch', fn: (e: FetchEvent) => void): void
  addEventListener(type: 'notificationclick', fn: (e: NotificationEvent) => void): void
}
declare const self: SwScope

// registerType 'autoUpdate': take over as soon as a new worker is installed.
void self.skipWaiting()
clientsClaim()

precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()
// SPA: every navigation falls back to the app shell (API URLs go to the network).
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html'), { denylist: [/^\/api\//] }))

type Payload = { title?: string; body?: string; url?: string; tag?: string }

self.addEventListener('push', (event) => {
  let p: Payload
  try {
    p = (event.data?.json() as Payload) ?? {}
  } catch {
    p = { body: event.data?.text() }
  }
  event.waitUntil(
    self.registration.showNotification(p.title || 'Enduro Tracker', {
      body: p.body ?? '',
      icon: '/pwa-192x192.png',
      badge: '/badge-96x96.png', // monochrome on transparent: Android masks it, an opaque icon turns into a white square
      tag: p.tag,
      data: { url: p.url || '/' },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const path = (event.notification.data as { url?: string } | undefined)?.url || '/'
  const target = new URL(path, self.location.origin).href
  event.waitUntil(
    (async () => {
      const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      const client = open.find((c) => new URL(c.url).origin === self.location.origin)
      if (client) {
        await client.focus()
        if (client.url !== target) await client.navigate(target).catch(() => null)
        return
      }
      await self.clients.openWindow(target)
    })(),
  )
})

// Share target: "Share → Enduro" from the gallery or Files lands here as a POST. Park the files, open the Invoice screen.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'POST' || new URL(event.request.url).pathname !== SHARE_PATH) return
  event.respondWith(
    (async () => {
      try {
        const form = await event.request.formData()
        const files = acceptShared(form.getAll('files').filter((f): f is File => f instanceof File))
        const cache = await caches.open(SHARE_CACHE)
        for (const k of await cache.keys()) await cache.delete(k)
        const at = String(Date.now())
        await Promise.all(
          files.map((f, i) =>
            cache.put(`/shared/${i}`, new Response(f, { headers: { 'Content-Type': f.type, 'X-Name': encodeURIComponent(f.name), 'X-Shared-At': at } })),
          ),
        )
      } catch {
        // fall through: the Invoice screen simply opens empty
      }
      return Response.redirect(new URL('/invoice', self.location.origin).href, 303)
    })(),
  )
})
