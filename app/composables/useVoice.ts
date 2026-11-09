import { errorMessage, OfflineError } from '~/offline/outbox'
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

export const WAITING_COPY = "Needs a connection — I'll keep it and answer when you're back online."

type SheetState = { status: 'listening' | 'done' | 'error'; result?: VoiceResult; error?: string }

// One voice sheet for the whole app.
const open = ref(false)
const sheet = ref<SheetState>({ status: 'listening' })
/** Last 3 question/answer turns of this sheet, sent with a follow-up. Never stored. */
const history = ref<Array<{ q: string; a: string }>>([])
const available = ref(false)
let checked = false

export function useVoice() {
  const { get, mutate } = useApi()

  async function checkAvailable() {
    if (checked) return
    try {
      available.value = (await get<{ available: boolean }>('/api/voice/status')).available
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

  async function post(form: FormData) {
    sheet.value = { status: 'listening' }
    open.value = true
    form.append('tz', localTz())
    if (history.value.length) form.append('history', JSON.stringify(history.value))
    show(await mutate<VoiceResult>('/api/voice', form))
  }

  /** A finished recording: answered now, or kept on the phone when there is no connection. */
  async function sendAudio(wav: ArrayBuffer) {
    try {
      await post(voiceForm(wav))
    } catch (err) {
      if (err instanceof OfflineError) {
        const uid = readSession()?.userId
        open.value = false
        if (uid) {
          await queueVoice(wav, uid)
          useToast().show(WAITING_COPY, 6000)
        }
        return
      }
      sheet.value = { status: 'error', error: errorMessage(err, "Voice couldn't be processed — try again.") }
    }
  }

  /** Resend a corrected transcript (skips transcription on the server). */
  async function sendTranscript(transcript: string) {
    const form = new FormData()
    form.append('transcript', transcript)
    try {
      await post(form)
    } catch (err) {
      sheet.value = { status: 'error', error: errorMessage(err, "Voice couldn't be processed — try again.") }
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

  return { open, sheet, history, available, checkAvailable, sendAudio, sendTranscript, openReady, close }
}
