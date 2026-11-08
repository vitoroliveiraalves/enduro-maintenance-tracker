import { authClient } from '~/lib/auth-client'
import { clearOfflineData } from '~/offline/db'
import { OfflineError } from '~/offline/outbox'
import { forgetSession } from '~/offline/session'
import { unsubscribeThisDevice } from './usePush'

/**
 * Forget everything this device holds for the rider: cached data, queued
 * writes, the last bike and the remembered session. Sign-out and account
 * deletion both end here, so the next person on a shared phone sees nothing.
 */
export async function forgetThisDevice() {
  await clearOfflineData()
  forgetSession()
  useBikesStore().setLast(null)
}

/** Sign out (online-only): push off for this device first, then the session, then local data. */
export async function signOutEverywhere() {
  if (navigator.onLine === false) throw new OfflineError()
  await unsubscribeThisDevice()
  let res: Awaited<ReturnType<typeof authClient.signOut>>
  try {
    res = await authClient.signOut()
  } catch {
    throw new OfflineError()
  }
  // 401 = already signed out on the server: still forget this device.
  if (res.error && res.error.status !== 401) throw new Error("Couldn't sign out. Try again.")
  await forgetThisDevice()
  await navigateTo('/login')
}
