import { msgs } from '~/lib/i18n'
import { errorMessage, OfflineError, statusOf } from '~/offline/outbox'
import { readSession } from '~/offline/session'
import { localTz, queueVoice, removeVoice, voiceForm } from '~/offline/voice'

/** What `POST /api/voice` answers (server/utils/voice.ts). */
export type VoiceResult = {
  transcript: string
  answer: string | null
  sources: Array<{ tool: string; ref: string; data: unknown }>
  proposals: Array<Record<string, unknown> & { kind: string }>
  notes: string[]
}

export const waitingCopy = () => msgs().voice.waiting

type SheetState = { status: 'listening' | 'done' | 'error'; result?: VoiceResult; error?: string }

// One voice sheet for the whole app.
const open = ref(false)
const sheet = ref<SheetState>({ status: 'listening' })
const submitting = ref(false)
/** Last 3 question/answer turns of this sheet, sent with a follow-up. Never stored. */
const history = ref<Array<{ q: string; a: string }>>([])
const available = ref(false)
/** Set up on the server but switched off for this account by the admin. */
const off = ref(false)
let checked = false

export function resetVoiceStatus() {
  checked = false
  available.value = false
  off.value = false
  submitting.value = false
  history.value = []
}

export function useVoice() {
  const { get, mutate } = useApi()

  async function checkAvailable(force = false) {
    if (checked && !force) return
    try {
      const s = await get<{ available: boolean; off?: boolean }>('/api/voice/status')
      available.value = s.available
      off.value = !!s.off
      checked = true
    } catch {
      // offline at start: try again on the next call
    }
  }

  function show(result: VoiceResult) {
    sheet.value = { status: 'done', result }
    open.value = true
    if (result.answer) history.value = [...history.value, { q: result.transcript, a: result.answer }].slice(-3)
  }

  async function post(form: FormData, openEarly = false) {
    sheet.value = { status: 'listening' }
    if (openEarly) open.value = true
    form.append('tz', localTz())
    if (history.value.length) form.append('history', JSON.stringify(history.value))
    show(await mutate<VoiceResult>('/api/voice', form))
  }

  /** A finished recording: answered now, or kept on the phone when there is no connection. */
  async function sendAudio(wav: ArrayBuffer) {
    submitting.value = true
    try {
      await post(voiceForm(wav), false)
    } catch (err) {
      if (err instanceof OfflineError) {
        const uid = readSession()?.userId
        open.value = false
        if (uid) {
          await queueVoice(wav, uid)
          useToast().show(waitingCopy(), 6000)
        }
        return
      }
      if (statusOf(err) === 403) {
        available.value = false
        off.value = true
      }
      sheet.value = { status: 'error', error: errorMessage(err, msgs().voice.failed) }
      open.value = true
    } finally {
      submitting.value = false
    }
  }

  /** Resend a corrected transcript (skips transcription on the server). */
  async function sendTranscript(transcript: string) {
    const form = new FormData()
    form.append('transcript', transcript)
    try {
      await post(form, true)
    } catch (err) {
      if (statusOf(err) === 403) {
        available.value = false
        off.value = true
      }
      sheet.value = { status: 'error', error: errorMessage(err, msgs().voice.failed) }
    }
  }

  /** Open an answer that came back while the rider was away, and forget it on the phone. */
  async function openReady(item: { id: number; result: unknown }) {
    history.value = []
    show(item.result as VoiceResult)
    await removeVoice(item.id)
  }

  function close() {
    open.value = false
    history.value = []
  }

  return { open, sheet, history, available, off, submitting, checkAvailable, sendAudio, sendTranscript, openReady, close }
}
