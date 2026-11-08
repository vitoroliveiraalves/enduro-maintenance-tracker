import { isStandalone, onIos, urlBase64ToUint8Array } from '~/lib/platform'

export type PushState =
  | 'loading'
  | 'ios-not-installed' // iOS Safari tab: Web Push only after Add to Home Screen (iOS 16.4+)
  | 'unsupported'
  | 'not-configured' // server has no VAPID keys
  | 'denied'
  | 'off'
  | 'on'

type Reg = { pushManager: PushManager }

/** Resolves the service worker registration, or null if it never becomes ready. */
function swReady(ms = 8000): Promise<Reg | null> {
  if (!('serviceWorker' in navigator)) return Promise.resolve(null)
  return Promise.race([navigator.serviceWorker.ready as Promise<Reg>, new Promise<null>((r) => setTimeout(() => r(null), ms))])
}

const timezone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone
  } catch {
    return undefined
  }
}

/** Web Push on/off for this device. */
export function usePush() {
  const { get, mutate } = useApi()
  const state = ref<PushState>('loading')
  const busy = ref(false)
  const error = ref('')
  let key = ''

  const save = (sub: PushSubscription) => mutate('/api/push/subscribe', { ...(sub.toJSON() as Record<string, unknown>), timezone: timezone() })

  async function init() {
    error.value = ''
    if (onIos() && !isStandalone()) return void (state.value = 'ios-not-installed')
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return void (state.value = 'unsupported')
    try {
      key = (await get<{ key: string }>('/api/push/vapid-key')).key
    } catch {
      return void (state.value = 'not-configured')
    }
    if (Notification.permission === 'denied') return void (state.value = 'denied')
    const reg = await swReady(3000)
    const sub = reg ? await reg.pushManager.getSubscription() : null
    state.value = sub && Notification.permission === 'granted' ? 'on' : 'off'
    // Keep the server row (and timezone) in step with this device.
    if (sub && state.value === 'on') save(sub).catch(() => {})
  }

  async function enable() {
    if (busy.value) return
    busy.value = true
    error.value = ''
    try {
      const perm = await Notification.requestPermission()
      if (perm !== 'granted') {
        state.value = perm === 'denied' ? 'denied' : 'off'
        return
      }
      const reg = await swReady()
      if (!reg) throw new Error('no service worker')
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) }))
      await save(sub)
      state.value = 'on'
    } catch {
      error.value = "Couldn't turn notifications on. Try again in a moment."
    } finally {
      busy.value = false
    }
  }

  async function disable() {
    if (busy.value) return
    busy.value = true
    error.value = ''
    try {
      const reg = await swReady()
      const sub = reg ? await reg.pushManager.getSubscription() : null
      if (sub) {
        await mutate('/api/push/unsubscribe', { endpoint: sub.endpoint })
        await sub.unsubscribe()
      }
      state.value = 'off'
    } catch {
      error.value = "Couldn't turn notifications off. Try again in a moment."
    } finally {
      busy.value = false
    }
  }

  return { state, busy, error, init, enable, disable }
}
