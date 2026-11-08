import { beforeEach, describe, expect, it, vi } from 'vitest'

const store = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
})

const { checkSession, readSession } = await import('../../../app/offline/session')

const user = { id: 'u1', email: 'rider@example.com' }
const ok = async () => ({ data: { user }, error: null })
const none = async () => ({ data: null, error: null })

beforeEach(() => store.clear())

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
