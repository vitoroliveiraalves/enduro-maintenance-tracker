import { createApi, isQueued, type MutateOpts } from '~/offline/api'
import { readSession } from '~/offline/session'
import { requestFlush } from './useOffline'

/**
 * The only way UI code talks to the API (Ruling R2).
 * - `get(url)`: network first; cached URLs (bikes, bike detail, item history,
 *   services, expenses, costs, categories, reminders) fall back to the last
 *   synced copy, with queued writes shown on top.
 * - `mutate(url, body, opts)`: adds a `clientId` to JSON bodies, passes
 *   FormData through. Online-only by default (throws OfflineError without a
 *   connection); `{ queue: true }` puts it in the offline outbox instead and
 *   resolves to `{ queued: true }` (check with `isQueued`).
 * Throws on other non-2xx, like $fetch.
 */
export type { MutateOpts }
export { isQueued }

// Nuxt's typed route inference is too deep for generic URLs; callers give the type.
type LooseFetch = (url: string, opts?: { method?: string; body?: unknown; timeout?: number }) => Promise<unknown>
const doFetch = (url: string, opts?: { method?: string; body?: unknown; timeout?: number }) => ($fetch as unknown as LooseFetch)(url, opts)
const isOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false

let api: ReturnType<typeof createApi> | null = null

export function useApi() {
  if (!api) api = createApi({ send: doFetch, online: isOnline, userId: () => readSession()?.userId ?? null, afterQueue: () => void requestFlush() })
  return api
}
