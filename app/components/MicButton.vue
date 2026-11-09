<script setup lang="ts">
// Round mic above the tabs. Hold ≥ 300 ms: release sends. Shorter tap: tap again to send.
const route = useRoute()
const { openSheets } = useSheets()
const { pending, failed, voiceWaiting, voiceReady } = useOffline()
const voice = useVoice()
const rec = useRecorder()

const ON = /^\/(history|costs|shelf)?$|^\/bikes\/[0-9a-f-]{36}$/
const visible = computed(() => voice.available.value && ON.test(route.path) && openSheets.value === 0 && !voice.open.value)
const badge = computed(() => pending.value > 0 || failed.value.length > 0 || voiceWaiting.value > 0 || voiceReady.value.length > 0)
const HOLD_MS = 300
let downAt = 0
let toggle = false
const blocked = ref(false)

onMounted(() => void voice.checkAvailable())
watch(() => route.path, () => void voice.checkAvailable())
rec.onAutoStop((wav) => void finish(wav))

async function finish(wav: ArrayBuffer | null) {
  toggle = false
  if (wav) await voice.sendAudio(wav)
}

async function down(e: PointerEvent) {
  ;(e.currentTarget as HTMLElement | null)?.setPointerCapture?.(e.pointerId)
  if (rec.state.value === 'recording') return void finish(await rec.stop()) // second tap in toggle mode
  downAt = Date.now()
  toggle = false
  await rec.start()
  blocked.value = rec.state.value === 'denied' || rec.state.value === 'unsupported'
}

async function up() {
  if (rec.state.value !== 'recording' || toggle) return
  if (Date.now() - downAt >= HOLD_MS) return void finish(await rec.stop())
  toggle = true // short tap: keep recording until the next tap
}

const clock = computed(() => `0:${String(rec.seconds.value).padStart(2, '0')}`)
</script>

<template>
  <div v-if="visible || rec.state.value === 'recording'">
    <div
      v-if="rec.state.value === 'recording'"
      class="fixed inset-x-3 z-30 mx-auto flex max-w-md items-center gap-3 rounded-2xl bg-surface p-3 pr-20 shadow-lg shadow-black/50"
      :style="{ bottom: `calc(3.5rem + env(safe-area-inset-bottom) + ${badge ? '3.5rem' : '0.75rem'})` }"
      data-testid="mic-recording"
    >
      <span class="size-2.5 shrink-0 animate-pulse rounded-full bg-danger" aria-hidden="true" />
      <span class="w-10 shrink-0 text-sm font-bold tabular-nums text-white" data-testid="mic-seconds">{{ clock }}</span>
      <span class="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-bg" aria-hidden="true">
        <span class="block h-full rounded-full bg-accent transition-[width] duration-100" :style="{ width: `${Math.round(rec.level.value * 100)}%` }" />
      </span>
      <button type="button" class="min-h-11 shrink-0 px-2 text-sm text-muted" data-testid="mic-cancel" @click="rec.cancel()">Cancel</button>
    </div>
    <p
      v-if="blocked && visible"
      class="fixed inset-x-3 z-30 mx-auto max-w-md rounded-2xl bg-surface p-3 pr-20 text-sm text-muted shadow-lg shadow-black/50"
      :style="{ bottom: `calc(3.5rem + env(safe-area-inset-bottom) + ${badge ? '3.5rem' : '0.75rem'})` }"
      data-testid="mic-blocked"
      @click="blocked = false"
    >
      <template v-if="rec.state.value === 'denied'">The microphone is blocked for this app. Allow it in your browser's site settings (the icon next to the address), then try again.</template>
      <template v-else>This browser can't record here. You can still type everything in the app.</template>
    </p>
    <button
      type="button"
      class="fixed right-3 z-30 flex size-14 touch-none select-none items-center justify-center rounded-full shadow-lg shadow-black/50"
      :class="rec.state.value === 'recording' ? 'bg-danger text-[#111]' : 'bg-accent text-[#111]'"
      :style="{ bottom: `calc(3.5rem + env(safe-area-inset-bottom) + ${badge ? '3.5rem' : '0.75rem'})` }"
      :aria-label="rec.state.value === 'recording' ? 'Stop and send voice note' : 'Voice note: hold to talk'"
      data-testid="mic"
      @pointerdown.prevent="down"
      @pointerup="up"
      @contextmenu.prevent
    >
      <svg viewBox="0 0 24 24" class="size-6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true">
        <rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor" />
        <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
      </svg>
    </button>
  </div>
</template>
