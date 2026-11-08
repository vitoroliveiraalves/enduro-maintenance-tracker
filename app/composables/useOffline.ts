import { ref } from 'vue'
import { onOutboxChange, type OutboxRow } from '~/offline/db'
import { dismissFailed, listOutbox } from '~/offline/outbox'
import { readSession } from '~/offline/session'
import { flushOutbox } from '~/offline/sync'

// One shared state for the whole app (badge, banner, pages).
const pending = ref(0)
const failed = ref<OutboxRow[]>([])
/** Bumped after a flush sent something: screens reload to show the server's view. */
const syncTick = ref(0)

let retryTimer: ReturnType<typeof setTimeout> | null = null
let started = false

async function refresh() {
  const rows = await listOutbox()
  failed.value = rows.filter((r) => r.error)
  pending.value = rows.length - failed.value.length
}

const isOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false

/** Replay the outbox now (no-op offline). `force` skips the backoff wait (we just came back online). */
export async function requestFlush(force = false) {
  if (!isOnline()) return
  const res = await flushOutbox({ force }).catch(() => null)
  if (!res) return
  if (res.sent) {
    // Refresh the cached views the replayed writes touched, then let screens reload.
    const { get } = useApi()
    await Promise.all([get('/api/bikes'), ...res.bikeIds.map((id) => get(`/api/bikes/${id}`))].map((p) => p.catch(() => null)))
    syncTick.value++
  }
  if (res.retryAt) {
    if (retryTimer) clearTimeout(retryTimer)
    retryTimer = setTimeout(() => void requestFlush(), Math.max(1000, res.retryAt - Date.now()))
  }
}

/**
 * "Last sync": once per app run, after the session is confirmed (auth middleware), fetch what the offline screens need even if the rider
 * hasn't opened them this session — garage, last bike, history, this month's
 * costs, and the categories the expense sheet picks from.
 */
let warmedFor: string | null = null // once per rider per app run
export async function warmCacheOnce() {
  const uid = readSession()?.userId
  if (!uid || uid === warmedFor || !isOnline()) return
  warmedFor = uid
  const { get } = useApi()
  const today = new Date().toISOString().slice(0, 10) // same default as the costs screen
  let lastBike: string | null = null
  try {
    lastBike = localStorage.getItem('enduro:lastBike')
  } catch {
    // no storage
  }
  const urls = ['/api/bikes', '/api/categories', '/api/services', '/api/expenses', `/api/costs?${new URLSearchParams({ period: 'month', date: today })}`]
  if (lastBike) urls.push(`/api/bikes/${lastBike}`)
  await Promise.all(urls.map((u) => get(u).catch(() => null)))
}

/**
 * Flush triggers (no Background Sync — iOS has none): app start, `online`,
 * and the app coming back to the foreground. Plus a slow poll while writes
 * are waiting, for a connection that comes back without an `online` event.
 */
export function startOfflineSync() {
  if (started) return
  started = true
  onOutboxChange(() => void refresh())
  void refresh()
  window.addEventListener('online', () => void requestFlush(true))
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void requestFlush()
  })
  setInterval(() => {
    if (pending.value) void requestFlush()
  }, 30_000)
  void requestFlush()
}

export function useOffline() {
  const online = useOnline()
  return {
    online,
    pending,
    failed,
    syncTick,
    flush: requestFlush,
    dismiss: (id: number) => dismissFailed(id),
  }
}
