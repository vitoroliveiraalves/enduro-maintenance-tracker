// Service worker (built by @vite-pwa/nuxt, strategies: 'injectManifest').
// Precache + SPA navigation fallback, as the generated worker did, plus Web Push.
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'
import { clientsClaim } from 'workbox-core'

// Minimal worker types: the app tsconfig uses the DOM lib, not WebWorker.
type ExtendableEvent = Event & { waitUntil(p: Promise<unknown>): void }
type PushEvent = ExtendableEvent & { data: { json(): unknown; text(): string } | null }
type NotificationEvent = ExtendableEvent & { notification: Notification & { data?: unknown; close(): void } }
type WindowClient = { url: string; focus(): Promise<WindowClient>; navigate(url: string): Promise<WindowClient | null> }
type SwScope = {
  __WB_MANIFEST: Array<{ url: string; revision: string | null } | string>
  location: Location
  registration: { showNotification(title: string, options?: NotificationOptions & { data?: unknown }): Promise<void> }
  clients: { matchAll(o: { type: 'window'; includeUncontrolled: boolean }): Promise<WindowClient[]>; openWindow(url: string): Promise<WindowClient | null> }
  skipWaiting(): Promise<void>
  addEventListener(type: 'push', fn: (e: PushEvent) => void): void
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
      badge: '/pwa-192x192.png',
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
