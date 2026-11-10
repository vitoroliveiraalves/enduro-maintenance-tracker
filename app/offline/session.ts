/**
 * Last known session, so the app opens offline instead of bouncing to /login.
 * Only the server saying "no session" signs the rider out; a failed request
 * (no signal) trusts the cache.
 */
export type CachedSession = { userId: string; email: string }
type Stored = CachedSession & { signedOut?: boolean }

const KEY = 'enduro:session'

function read(): Stored | null {
  try {
    const raw = localStorage.getItem(KEY)
    const v = raw ? (JSON.parse(raw) as Stored) : null
    return v && typeof v.userId === 'string' ? v : null
  } catch {
    return null
  }
}

function write(v: Stored | null) {
  try {
    if (v) localStorage.setItem(KEY, JSON.stringify(v))
    else localStorage.removeItem(KEY)
  } catch {
    // storage unavailable: offline start just won't know the session
  }
}

export function readSession(): CachedSession | null {
  const v = read()
  return v && !v.signedOut ? { userId: v.userId, email: v.email } : null
}

/** Explicit sign-out / account deletion: forget who used this device. */
export function forgetSession() {
  write(null)
  resetSessionChecks()
}

type SessionResult = { data: { user: { id: string; email: string } } | null; error: { status?: number } | null }

/** A session call slower than this (weak signal) is treated like no signal: trust the cache. */
export const SESSION_TIMEOUT_MS = 3_000
/** Re-ask the server about a cached session at most this often (plus once per app start / after a 401). */
export const SESSION_RECHECK_MS = 10 * 60_000

class SessionTimeout extends Error {}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new SessionTimeout('session check timed out')), ms)
  })
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer))
}

// Per app start (module state): when the server was last asked, and whether a 401 since asks again.
let lastAsked: number | null = null
let stale = false

/** An API call answered 401: the next navigation asks the server again. */
export function markSessionStale() {
  stale = true
}

/** Tests only: forget the per-run state, like a fresh app start. */
export function resetSessionChecks() {
  lastAsked = null
  stale = false
}

/**
 * The route guard's view of the session. With a cached signed-in user it asks
 * the server only once per app start, after a 401, or every 10 minutes; any
 * other navigation answers from the cache straight away. Without a cached
 * user (signed out, first run) it always asks.
 */
export async function sessionForRoute(
  fetchSession: () => Promise<SessionResult>,
  online: boolean,
  now = Date.now(),
): Promise<{ user: CachedSession | null; changedUser: boolean }> {
  const cached = readSession()
  if (cached && !stale && lastAsked !== null && now - lastAsked < SESSION_RECHECK_MS) return { user: cached, changedUser: false }
  if (online) {
    lastAsked = now
    stale = false
  }
  return checkSession(fetchSession, online)
}

/**
 * `changedUser`: a different account than the one cached here signed in, so
 * the previous user's offline data must be wiped before anything is shown.
 */
export async function checkSession(fetchSession: () => Promise<SessionResult>, online: boolean): Promise<{ user: CachedSession | null; changedUser: boolean }> {
  const cached = () => ({ user: readSession(), changedUser: false })
  if (!online) return cached()
  let res: SessionResult
  try {
    // Weak signal: give up after 3 s and trust the cache, same as no signal.
    res = await withTimeout(fetchSession(), SESSION_TIMEOUT_MS)
  } catch {
    return cached()
  }
  const status = res.error?.status
  // No real answer (network, 5xx, or 429 rate limited): trust the cache; only a real "no session" signs out.
  if (res.error && (!status || status >= 500 || status === 429)) return cached()
  const u = res.data?.user
  const prev = read()
  if (!u) {
    // The server says no session: signed out. Keep the id (not the session) so
    // the same rider signing back in keeps any writes still queued.
    if (prev) write({ ...prev, signedOut: true })
    return { user: null, changedUser: false }
  }
  const user = { userId: u.id, email: u.email }
  write(user)
  return { user, changedUser: prev?.userId !== u.id }
}

/**
 * Who the server says is signed in right now, or null (nobody, or no answer).
 * The outbox flush asks this before sending anything: never the cache.
 */
export async function serverUserId(fetchSession: () => Promise<SessionResult>): Promise<string | null> {
  try {
    const res = await fetchSession()
    const id = res.data?.user?.id ?? null
    // The server sees someone else (or nobody) than this device remembers: the next navigation re-checks.
    const cached = readSession()?.userId
    if (cached && !res.error && id !== cached) markSessionStale()
    return id
  } catch {
    return null
  }
}
