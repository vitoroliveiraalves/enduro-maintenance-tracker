import { ref } from 'vue'
import { authClient } from '~/lib/auth-client'
import { onOutboxChange } from '~/offline/db'
import { dismissFailed, listOutbox, retryFailed } from '~/offline/outbox'
import { listPhotos, removePhoto, retryPhoto } from '~/offline/photos'
import { readSession, serverUserId } from '~/offline/session'
import { flushOutbox } from '~/offline/sync'

/** One thing in the pending sheet: a queued write or a set of invoice photos. */
export type PendingItem = { key: string; kind: 'write' | 'photos'; id: number; label: string; error?: string }

// One shared state for the whole app (badge, banners, pages).
const waiting = ref<PendingItem[]>([]) // queued writes still to send
const failed = ref<PendingItem[]>([]) // refused / out of retries: shown until dismissed
const pending = ref(0) // waiting writes (the badge count)
const invoicesWaiting = ref(0) // offline invoice photo sets still to upload
/** Documents uploaded from offline photos during this run: the rider reviews them next. */
const uploaded = ref<string[]>([])
/** Bumped after a flush sent something: screens reload to show the server's view. */
const syncTick = ref(0)

let retryTimer: ReturnType<typeof setTimeout> | null = null
let started = false

async function refresh() {
  const [rows, photos] = await Promise.all([listOutbox(), listPhotos()])
  const items: PendingItem[] = [
    ...rows.map((r) => ({ key: `w${r.id}`, kind: 'write' as const, id: r.id!, label: r.label, error: r.error })),
    ...photos.map((p) => ({
      key: `p${p.id}`,
      kind: 'photos' as const,
      id: p.id!,
      label: `Invoice · ${p.files.length} ${p.files.length === 1 ? 'page' : 'pages'}`,
      error: p.error,
    })),
  ]
  failed.value = items.filter((i) => i.error)
  waiting.value = items.filter((i) => !i.error && i.kind === 'write')
  pending.value = waiting.value.length
  invoicesWaiting.value = photos.filter((p) => !p.error).length
}

const isOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false

/** Replay the outbox now (no-op offline). `force` skips the backoff wait (we just came back online). */
export async function requestFlush(force = false) {
  if (!isOnline()) return
  const res = await flushOutbox({ force, currentUser: () => serverUserId(() => authClient.getSession()) }).catch(() => null)
  if (!res) return
  if (res.documents.length) uploaded.value = [...new Set([...uploaded.value, ...res.documents])]
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
 * "Last sync": once per app run, after the session is confirmed (auth middleware),
 * fetch what the offline screens need even if the rider hasn't opened them this
 * session — garage, last bike, history, this month's costs, and the categories
 * the expense sheet picks from.
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
 * Flush triggers (no Background Sync — iOS has none): app start (once the auth
 * middleware has confirmed who is signed in), `online`, and the app coming
 * back to the foreground. Plus a slow poll while things are waiting, for a
 * connection that comes back without an `online` event.
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
    if (pending.value || invoicesWaiting.value) void requestFlush()
  }, 30_000)
}

/** Forget a pending or failed item (Dismiss on a refusal, Discard on a waiting change). */
async function remove(item: PendingItem) {
  await (item.kind === 'photos' ? removePhoto(item.id) : dismissFailed(item.id))
  syncTick.value++ // screens reload without the discarded change on top
}

/** Retry on a set-aside item: back in the queue with a fresh retry count, then send now. */
async function retry(item: PendingItem) {
  await (item.kind === 'photos' ? retryPhoto(item.id) : retryFailed(item.id))
  await requestFlush(true)
}

export function useOffline() {
  const online = useOnline()
  return {
    online,
    pending,
    waiting,
    failed,
    invoicesWaiting,
    uploaded,
    syncTick,
    flush: requestFlush,
    remove,
    retry,
    forgetUploaded: (id?: string) => (uploaded.value = id ? uploaded.value.filter((d) => d !== id) : []),
  }
}
