<script setup lang="ts">
import { itemLabel, serverText } from '~/lib/server-text'
import { tick } from '~/lib/haptics'
// Listening → editable transcript → answer (with the facts it used) and/or cards to review and save.
import { draftFrom, requestFor, type CardCtx, type Draft } from '~/lib/voice-cards'
import { sourceLines } from '~/lib/voice-sources'
import { errorMessage } from '~/offline/outbox'

const { t, locale } = useI18n()
const voice = useVoice()
const { get, mutate } = useApi()
const { syncTick } = useOffline()
const open = computed({ get: () => voice.open.value, set: (v) => (v ? (voice.open.value = true) : voice.close()) })
const result = computed(() => (voice.sheet.value.status === 'done' ? voice.sheet.value.result : undefined))

const text = ref('')
const cards = ref<Draft[]>([])
const ctx = ref<CardCtx>({ bikes: [], parts: [], categories: [], today: '' })
const items = ref<Record<string, Array<{ id: string; name: string }>>>({})
const ctxError = ref('')
const saving = ref(false)

const localToday = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

async function loadItems(bikeId: string) {
  if (!bikeId || items.value[bikeId]) return
  try {
    const detail = await get<{ items: Array<{ id: string; name: string }> }>(`/api/bikes/${bikeId}`)
    items.value = { ...items.value, [bikeId]: detail.items.map((i) => ({ id: i.id, name: itemLabel(i.name) })) }
  } catch {
    // the card still shows the bike; items appear when the detail loads
  }
}

/**
 * A follow-up adds its cards to the ones still on the sheet; "Send again" (a corrected
 * transcript) replaces the unsaved ones it came from. Saved cards always stay, shown as Saved.
 */
let replaceUnsaved = false
function resend() {
  replaceUnsaved = true
  void voice.sendTranscript(text.value.trim())
}

watch(result, async (r) => {
  if (!r) return
  text.value = r.transcript
  const keep = replaceUnsaved ? cards.value.filter((c) => c.status === 'saved') : cards.value
  replaceUnsaved = false
  if (!r.proposals.length) return void (cards.value = keep)
  ctxError.value = ''
  try {
    const [bikes, parts, categories] = await Promise.all([
      get<CardCtx['bikes']>('/api/bikes'),
      get<CardCtx['parts']>('/api/parts').catch(() => []),
      get<CardCtx['categories']>('/api/categories').catch(() => []),
    ])
    ctx.value = { bikes, parts, categories, today: localToday() }
  } catch (e) {
    ctxError.value = errorMessage(e, t.value.voiceSheet.loadBikesFailed)
  }
  cards.value = [...keep, ...r.proposals.map((p) => draftFrom(p, ctx.value))]
  await Promise.all(ctx.value.bikes.map((b) => loadItems(b.id)))
}, { immediate: true })

const toSave = computed(() => cards.value.filter((c) => c.status !== 'saved'))

/** One card at a time through the existing routes; each shows Saved or why it failed (Retry = Save again). */
async function saveAll() {
  if (saving.value) return
  saving.value = true
  let any = false
  try {
    for (const c of toSave.value) {
      const req = requestFor(c, ctx.value)
      if ('error' in req) {
        Object.assign(c, { status: 'failed', error: req.error })
        continue
      }
      c.status = 'saving'
      try {
        await mutate(req.url, req.body, req.method ? { method: req.method } : { queue: true })
        Object.assign(c, { status: 'saved', error: '' })
        any = true
      } catch (e) {
        Object.assign(c, { status: 'failed', error: errorMessage(e, t.value.voiceSheet.saveOneFailed) })
      }
    }
  } finally {
    saving.value = false
  }
  if (any) syncTick.value++ // screens reload with the new records
}

// Speaker: the browser's own voice, no server.
const canSpeak = typeof window !== 'undefined' && 'speechSynthesis' in window
const PT = /[ãõçáéíóúâêà]|\b(não|sim|tenho|fiz|troquei|óleo|quando|quanto|mudei)\b/i
function speak(answer: string) {
  window.speechSynthesis.cancel()
  const u = new SpeechSynthesisUtterance(answer)
  u.lang = PT.test(result.value?.transcript ?? '') || (!result.value?.transcript && locale.value === 'pt') ? 'pt-PT' : 'en-GB'
  window.speechSynthesis.speak(u)
}

// Follow-up question without leaving the sheet (previous turns go along, this sheet only).
const rec = useRecorder()
async function followUp() {
  tick()
  if (rec.state.value === 'recording') {
    const wav = await rec.stop()
    if (wav) await voice.sendAudio(wav)
    return
  }
  await rec.start()
}
rec.onAutoStop((wav) => {
  if (wav) void voice.sendAudio(wav)
})
watch(open, (v) => {
  if (v) return
  rec.cancel()
  cards.value = [] // a new note starts with a clean sheet
})
</script>

<template>
  <Sheet v-model:open="open" :title="t.voiceSheet.title" testid="voice-sheet">
    <div v-if="voice.sheet.value.status === 'listening'" class="flex flex-col items-center justify-center py-8 gap-3" data-testid="voice-listening">
      <div class="flex items-center gap-1.5 h-6" aria-hidden="true">
        <span class="inline-block w-1.5 rounded-full bg-accent animate-pulse h-3" />
        <span class="inline-block w-1.5 rounded-full bg-accent animate-pulse h-5" style="animation-delay: 150ms" />
        <span class="inline-block w-1.5 rounded-full bg-accent animate-pulse h-6" style="animation-delay: 300ms" />
        <span class="inline-block w-1.5 rounded-full bg-accent animate-pulse h-4" style="animation-delay: 450ms" />
        <span class="inline-block w-1.5 rounded-full bg-accent animate-pulse h-2.5" style="animation-delay: 600ms" />
      </div>
      <p class="text-sm font-medium text-muted">{{ t.voiceSheet.working }}</p>
    </div>
    <p v-else-if="voice.sheet.value.status === 'error'" role="alert" class="text-sm text-danger-text" data-testid="voice-error">{{ voice.sheet.value.error }}</p>

    <template v-if="result">
      <label class="block text-xs text-muted">{{ t.voiceSheet.heard }}
        <textarea v-model="text" rows="2" maxlength="2000" class="mt-1 w-full rounded-lg border border-white/10 bg-bg px-2.5 py-2 text-base text-text outline-none focus:border-accent" data-testid="voice-transcript" />
      </label>
      <button
        v-if="text.trim() && text.trim() !== result.transcript"
        type="button"
        class="mt-1 min-h-11 rounded-lg border border-white/15 px-3 text-sm font-semibold text-white active:scale-95 transition-transform"
        data-testid="voice-resend"
        :disabled="voice.sheet.value.status === 'listening'"
        @click="resend"
      >
        {{ t.voiceSheet.sendAgain }}
      </button>

      <ul v-if="result.notes.length" class="mt-2 space-y-0.5 text-xs text-muted" data-testid="voice-notes">
        <li v-for="n in result.notes" :key="n">{{ serverText(n) }}</li>
      </ul>

      <section v-if="result.answer" class="mt-3 rounded-xl bg-bg p-3" data-testid="voice-answer">
        <div class="flex items-start gap-2">
          <p class="min-w-0 flex-1 text-base text-white" data-testid="voice-answer-text">{{ result.answer }}</p>
          <button v-if="canSpeak" type="button" class="-mr-1 -mt-1 flex size-11 shrink-0 items-center justify-center text-muted active:scale-95 transition-transform" :aria-label="t.voiceSheet.readAloud" data-testid="voice-speak" @click="speak(result.answer)"><Icon name="speaker" /></button>
        </div>
        <template v-if="result.sources.length">
          <p class="mt-2 text-[11px] font-semibold uppercase tracking-wide text-muted">{{ t.voiceSheet.fromRecords }}</p>
          <ul class="mt-1 space-y-0.5 text-sm text-muted">
            <template v-for="src in result.sources" :key="src.ref">
              <li v-for="line in sourceLines(src)" :key="line" data-testid="voice-source">{{ line }}</li>
            </template>
          </ul>
        </template>
      </section>

    </template>

    <!-- Talk again: say what you want next, or just the correction. -->
    <div v-if="voice.available.value && voice.sheet.value.status !== 'listening'" class="mt-3">
      <Transition
        enter-active-class="transition duration-200 ease-out"
        enter-from-class="-translate-y-2 opacity-0"
        enter-to-class="translate-y-0 opacity-100"
        leave-active-class="transition duration-150 ease-in"
        leave-from-class="translate-y-0 opacity-100"
        leave-to-class="-translate-y-2 opacity-0"
      >
        <div v-if="rec.state.value === 'asking' || rec.state.value === 'recording'" class="mb-2 flex items-center gap-3 rounded-xl bg-bg p-3 ring-1 ring-white/10" role="status" data-testid="voice-recording">
          <span class="size-2.5 shrink-0 rounded-full" :class="rec.state.value === 'recording' ? 'animate-pulse bg-danger' : 'bg-muted'" aria-hidden="true" />
          <span class="text-sm font-semibold text-white">{{ rec.state.value === 'recording' ? t.voiceSheet.listening : t.voiceSheet.startingMic }}</span>
          <span v-if="rec.state.value === 'recording'" class="ml-auto font-tag text-sm tabular-nums text-white">0:{{ String(rec.seconds.value).padStart(2, '0') }}</span>
        </div>
      </Transition>
      <button
        type="button"
        class="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border text-sm font-semibold transition-all duration-150 active:scale-95"
        :class="rec.state.value === 'recording' ? 'border-danger text-danger-text' : 'border-white/15 text-white'"
        :disabled="rec.state.value === 'asking'"
        data-testid="voice-followup"
        @click="followUp"
      >
        <Icon v-if="rec.state.value !== 'recording'" name="mic" :size="18" />
        {{ rec.state.value === 'recording' ? t.voiceSheet.tapToSend : rec.state.value === 'asking' ? t.voiceSheet.starting : t.voiceSheet.tapToSpeak }}
      </button>
      <p v-if="rec.state.value === 'denied'" class="mt-2 text-sm text-muted">{{ t.voiceSheet.denied }}</p>
    </div>

    <!-- Cards outlive a follow-up: still visible while it is listening or if it fails. -->
      <p v-if="ctxError" role="alert" class="mt-3 text-sm text-danger-text">{{ ctxError }}</p>
      <ul v-if="cards.length" class="mt-3 space-y-2">
        <VoiceProposalCard v-for="(c, i) in cards" :key="c.key" v-model="cards[i]!" :ctx="ctx" :items="items" @remove="cards.splice(i, 1)" />
      </ul>
      <button
        v-if="toSave.length"
        type="button"
        :disabled="saving || voice.sheet.value.status === 'listening'"
        class="mt-3 w-full rounded-xl bg-accent py-3 text-sm font-bold text-on-accent disabled:opacity-60"
        data-testid="voice-save"
        @click="saveAll"
      >
        {{ saving ? t.common.saving : toSave.some((c) => c.status === 'failed') ? t.common.retry : toSave.length === 1 ? t.common.save : t.voiceSheet.saveN(toSave.length) }}
      </button>

  </Sheet>
</template>
