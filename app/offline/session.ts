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
}

type SessionResult = { data: { user: { id: string; email: string } } | null; error: { status?: number } | null }

/**
 * `changedUser`: a different account than the one cached here signed in, so
 * the previous user's offline data must be wiped before anything is shown.
 */
export async function checkSession(fetchSession: () => Promise<SessionResult>, online: boolean): Promise<{ user: CachedSession | null; changedUser: boolean }> {
  const cached = () => ({ user: readSession(), changedUser: false })
  if (!online) return cached()
  let res: SessionResult
  try {
    res = await fetchSession()
  } catch {
    return cached()
  }
  const status = res.error?.status
  if (res.error && (!status || status >= 500)) return cached()
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
    return res.data?.user?.id ?? null
  } catch {
    return null
  }
}
