import { beforeEach, describe, expect, it, vi } from 'vitest'

const store = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
})

const { checkSession, markSessionStale, serverUserId, readSession, resetSessionChecks, sessionForRoute, SESSION_RECHECK_MS, SESSION_TIMEOUT_MS } = await import('../../../app/offline/session')

const user = { id: 'u1', email: 'rider@example.com' }
const ok = async () => ({ data: { user }, error: null })
const none = async () => ({ data: null, error: null })

beforeEach(() => {
  store.clear()
  resetSessionChecks()
})

describe('checkSession (auth middleware offline)', () => {
  it('remembers the signed-in user', async () => {
    expect(await checkSession(ok, true)).toEqual({ user: { userId: 'u1', email: 'rider@example.com' }, changedUser: true })
    expect(readSession()).toEqual({ userId: 'u1', email: 'rider@example.com' })
    expect((await checkSession(ok, true)).changedUser).toBe(false)
  })

  it('trusts the cached session when the network call fails', async () => {
    await checkSession(ok, true)
    const boom = async () => {
      throw new TypeError('Failed to fetch')
    }
    expect((await checkSession(boom, true)).user?.userId).toBe('u1')
    expect((await checkSession(async () => ({ data: null, error: { status: 0 } }), true)).user?.userId).toBe('u1')
    expect((await checkSession(async () => ({ data: null, error: { status: 502 } }), true)).user?.userId).toBe('u1')
  })

  it('trusts the cache without calling the network when the browser is offline', async () => {
    await checkSession(ok, true)
    const fetcher = vi.fn(ok)
    expect((await checkSession(fetcher, false)).user?.userId).toBe('u1')
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('only signs out when the server answers with no session', async () => {
    await checkSession(ok, true)
    expect((await checkSession(none, true)).user).toBeNull()
    expect(readSession()).toBeNull()
    await checkSession(ok, true)
    expect((await checkSession(async () => ({ data: null, error: { status: 401 } }), true)).user).toBeNull()
  })

  it('no cache and no network: not signed in', async () => {
    expect((await checkSession(none, false)).user).toBeNull()
  })

  it('flags a different user on this device', async () => {
    await checkSession(ok, true)
    const other = async () => ({ data: { user: { id: 'u2', email: 'b@example.com' } }, error: null })
    expect((await checkSession(other, true)).changedUser).toBe(true)
  })
})

describe('weak signal (final review #3)', () => {
  it('a session call that hangs falls back to the cached session after 3 s', async () => {
    await checkSession(ok, true)
    vi.useFakeTimers()
    try {
      const hang = () => new Promise<never>(() => {})
      const p = checkSession(hang, true)
      let done = false
      void p.then(() => (done = true))
      await vi.advanceTimersByTimeAsync(SESSION_TIMEOUT_MS - 1)
      expect(done).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      expect(await p).toEqual({ user: { userId: 'u1', email: 'rider@example.com' }, changedUser: false })
    } finally {
      vi.useRealTimers()
    }
    expect(SESSION_TIMEOUT_MS).toBe(3_000)
  })

  it('a hanging call with no cache is not signed in (after the timeout)', async () => {
    vi.useFakeTimers()
    try {
      const p = checkSession(() => new Promise<never>(() => {}), true)
      await vi.advanceTimersByTimeAsync(SESSION_TIMEOUT_MS)
      expect((await p).user).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('asks the server once per app start, then only after a 401 or 10 min', async () => {
    const t0 = 1_000_000
    const fetcher = vi.fn(ok)
    expect((await sessionForRoute(fetcher, true, t0)).user?.userId).toBe('u1')
    expect((await sessionForRoute(fetcher, true, t0 + 1_000)).user?.userId).toBe('u1')
    expect((await sessionForRoute(fetcher, true, t0 + 60_000)).user?.userId).toBe('u1')
    expect(fetcher).toHaveBeenCalledTimes(1)
    markSessionStale()
    await sessionForRoute(fetcher, true, t0 + 61_000)
    expect(fetcher).toHaveBeenCalledTimes(2)
    await sessionForRoute(fetcher, true, t0 + 62_000)
    expect(fetcher).toHaveBeenCalledTimes(2)
    await sessionForRoute(fetcher, true, t0 + 61_000 + SESSION_RECHECK_MS)
    expect(fetcher).toHaveBeenCalledTimes(3)
  })

  it('the flush seeing another user (or nobody) on the server makes the next navigation re-check', async () => {
    const fetcher = vi.fn(ok)
    await sessionForRoute(fetcher, true, 1)
    expect(await serverUserId(async () => ({ data: { user: { id: 'u2', email: 'b@example.com' } }, error: null }))).toBe('u2')
    const other = vi.fn(async () => ({ data: { user: { id: 'u2', email: 'b@example.com' } }, error: null }))
    expect(await sessionForRoute(other, true, 2)).toMatchObject({ user: { userId: 'u2' }, changedUser: true })
    expect(other).toHaveBeenCalledTimes(1)
  })

  it('without a cached user it always asks (login, register, after sign-out)', async () => {
    const fetcher = vi.fn(none)
    await sessionForRoute(fetcher, true, 1)
    await sessionForRoute(fetcher, true, 2)
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
})
