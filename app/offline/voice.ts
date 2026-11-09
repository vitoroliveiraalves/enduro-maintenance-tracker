import { getDb, notifyOutbox, offlineGeneration, type PendingVoice } from './db'
import { describeError, statusOf } from './outbox'
import type { Send } from './api'

export const localTz = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

/** Keep a voice note on this phone until it can be sent. */
export async function queueVoice(data: ArrayBuffer, userId: string): Promise<PendingVoice> {
  const row: PendingVoice = { clientId: crypto.randomUUID(), userId, data, tz: localTz(), createdAt: Date.now(), attempts: 0 }
  row.id = await getDb().pendingVoice.add(row)
  notifyOutbox()
  return row
}

export async function listVoice(): Promise<PendingVoice[]> {
  try {
    return await getDb().pendingVoice.orderBy('id').toArray()
  } catch {
    return []
  }
}

export async function removeVoice(id: number): Promise<void> {
  await getDb().pendingVoice.delete(id)
  notifyOutbox()
}

export async function retryVoice(id: number): Promise<void> {
  await getDb().pendingVoice.update(id, { error: undefined, attempts: 0 })
  notifyOutbox()
}

export function voiceForm(audio: ArrayBuffer, extra: Record<string, string> = {}): FormData {
  const form = new FormData()
  form.append('audio', new Blob([audio], { type: 'audio/wav' }), 'note.wav')
  for (const [k, v] of Object.entries(extra)) form.append(k, v)
  return form
}

/**
 * Sends the waiting voice notes of the signed-in rider, oldest first, and keeps each
 * answer (not the audio) for the rider to open. Stops at the first network error or 401;
 * any other refusal is set aside with its reason (Retry / Discard).
 */
let running: Promise<number> | null = null

export function flushVoice(send: Send, uid: string): Promise<number> {
  // One at a time: a note can take up to a minute and a half; a second trigger must not resend it.
  if (!running) running = run(send, uid).finally(() => (running = null))
  return running
}

async function run(send: Send, uid: string): Promise<number> {
  const db = getDb()
  const gen = offlineGeneration()
  let done = 0
  for (const snap of (await listVoice()).filter((v) => v.userId === uid && !v.error && v.result === undefined)) {
    if (offlineGeneration() !== gen) break
    const row = await db.pendingVoice.get(snap.id!)
    if (!row || row.error || row.result !== undefined) continue
    try {
      const result = await send('/api/voice', { method: 'POST', body: voiceForm(row.data, { tz: row.tz }), timeout: 90_000 })
      await db.pendingVoice.update(row.id!, { result, data: new ArrayBuffer(0) })
      done++
    } catch (err) {
      const status = statusOf(err)
      if (status === undefined || status === 401) break
      await db.pendingVoice.update(row.id!, { attempts: row.attempts + 1, error: describeError(err) })
    }
    notifyOutbox()
  }
  return done
}
