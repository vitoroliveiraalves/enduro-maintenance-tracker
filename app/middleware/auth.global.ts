import { authClient } from '~/lib/auth-client'
import { clearOfflineData } from '~/offline/db'
import { sessionForRoute } from '~/offline/session'
import { requestFlush, warmCacheOnce } from '~/composables/useOffline'
import { resetVoiceStatus } from '~/composables/useVoice'

const PUBLIC = ['/login', '/register']

export default defineNuxtRouteMiddleware(async (to) => {
  const isPublic = PUBLIC.includes(to.path)
  // A failed or slow (> 3 s) request trusts the last known session; only the
  // server answering "no session" sends the rider to /login. The server is
  // asked once per app start, after a 401, or every 10 min — not on every route.
  const { user, changedUser } = await sessionForRoute(() => authClient.getSession(), navigator.onLine !== false)
  if (changedUser) {
    // Another account on this device: never show the previous rider's data.
    await clearOfflineData()
    resetVoiceStatus()
    useBikesStore().setLast(null)
  }
  // Fill the offline cache for screens not opened yet (non-blocking, once per run).
  if (user) {
    void warmCacheOnce()
    // Writes queued by this rider go now; the flush re-checks the session with the server itself.
    void requestFlush()
  }
  if (!user && !isPublic) return navigateTo('/login')
  if (user && isPublic) return navigateTo('/')
})
