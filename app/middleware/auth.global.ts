import { authClient } from '~/lib/auth-client'
import { clearOfflineData } from '~/offline/db'
import { checkSession } from '~/offline/session'
import { warmCacheOnce } from '~/composables/useOffline'

const PUBLIC = ['/login', '/register']

export default defineNuxtRouteMiddleware(async (to) => {
  const isPublic = PUBLIC.includes(to.path)
  // A failed request (no signal) trusts the last known session; only the
  // server answering "no session" sends the rider to /login.
  const { user, changedUser } = await checkSession(() => authClient.getSession(), navigator.onLine !== false)
  if (changedUser) {
    // Another account on this device: never show the previous rider's data.
    await clearOfflineData()
    useBikesStore().setLast(null)
  }
  // Fill the offline cache for screens not opened yet (non-blocking, once per run).
  if (user) void warmCacheOnce()
  if (!user && !isPublic) return navigateTo('/login')
  if (user && isPublic) return navigateTo('/')
})
