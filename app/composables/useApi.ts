/**
 * The only way UI code talks to the API. Online-only for now (Task 12 adds
 * the offline outbox inside `mutate`). Throws on non-2xx, like $fetch.
 */
type MutateOpts = { method?: 'POST' | 'PUT' | 'PATCH' | 'DELETE' }

// Nuxt's typed route inference is too deep for generic URLs; callers give the type.
type LooseFetch = (url: string, opts?: { method?: string; body?: unknown }) => Promise<unknown>
const doFetch = (url: string, opts?: { method?: string; body?: unknown }) => ($fetch as unknown as LooseFetch)(url, opts)

export function useApi() {
  function get<T>(url: string): Promise<T> {
    return doFetch(url) as Promise<T>
  }

  function mutate<T>(url: string, body: Record<string, unknown> | FormData, opts: MutateOpts = {}): Promise<T> {
    const payload = body instanceof FormData || 'clientId' in body ? body : { ...body, clientId: crypto.randomUUID() }
    return doFetch(url, { method: opts.method ?? 'POST', body: payload }) as Promise<T>
  }

  return { get, mutate }
}
