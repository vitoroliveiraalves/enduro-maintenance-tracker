<script setup lang="ts">
import { tick } from '~/lib/haptics'

const { t } = useI18n()
const route = useRoute()
const { openSheets } = useSheets()
const { pending, failed, voiceWaiting, voiceReady } = useOffline()
const voice = useVoice()
const rec = useRecorder()

const ON = /^\/(history|costs|shelf)?$|^\/bikes\/[0-9a-f-]{36}$/
const visible = computed(() => voice.available.value && ON.test(route.path) && openSheets.value === 0 && !voice.open.value)
const badge = computed(() => pending.value > 0 || failed.value.length > 0 || voiceWaiting.value > 0 || voiceReady.value.length > 0)
const active = computed(() => rec.state.value === 'recording' || voice.submitting.value)
const HOLD_MS = 300
let downAt = 0
let toggle = false
const blocked = ref(false)

onMounted(() => void voice.checkAvailable())
watch(() => route.path, () => void voice.checkAvailable())
rec.onAutoStop((wav) => void finish(wav))

async function finish(wav: ArrayBuffer | null) {
  tick()
  toggle = false
  if (wav) await voice.sendAudio(wav)
}

async function down(e: PointerEvent) {
  if (voice.submitting.value) return
  tick()
  ;(e.currentTarget as HTMLElement | null)?.setPointerCapture?.(e.pointerId)
  if (rec.state.value === 'recording') return void finish(await rec.stop()) // second tap in toggle mode
  downAt = Date.now()
  toggle = false
  await rec.start()
  blocked.value = rec.state.value === 'denied' || rec.state.value === 'unsupported'
}

async function up() {
  if (rec.state.value !== 'recording' || toggle) return
  if (Date.now() - downAt >= HOLD_MS) {
    tick()
    return void finish(await rec.stop())
  }
  toggle = true // short tap: keep recording until the next tap
}

function onCancel() {
  tick()
  rec.cancel()
}

const clock = computed(() => `0:${String(rec.seconds.value).padStart(2, '0')}`)

// 4 equalizer bars dancing smoothly with mic volume level
const waveformBars = computed(() => {
  const l = rec.level.value
  return [
    Math.max(4, Math.round(l * 16 * 0.7)),
    Math.max(4, Math.round(l * 20 * 1.0)),
    Math.max(4, Math.round(l * 18 * 0.85)),
    Math.max(4, Math.round(l * 14 * 0.6)),
  ]
})
</script>

<template>
  <div v-if="visible || active">
    <Transition
      enter-active-class="transition duration-200 ease-out"
      enter-from-class="translate-y-4 opacity-0 scale-95"
      enter-to-class="translate-y-0 opacity-100 scale-100"
      leave-active-class="transition duration-150 ease-in"
      leave-from-class="translate-y-0 opacity-100 scale-100"
      leave-to-class="translate-y-4 opacity-0 scale-95"
    >
      <div
        v-if="active"
        class="fixed inset-x-3 z-30 mx-auto flex max-w-md items-center gap-3 rounded-2xl bg-surface p-3 pr-20 shadow-lg shadow-black/50 ring-1 ring-white/10 lg:!bottom-6 lg:!right-24 lg:!left-auto lg:!w-96 lg:!mx-0"
        :style="{ bottom: `calc(3.5rem + env(safe-area-inset-bottom) + ${badge ? '3.5rem' : '0.75rem'})` }"
        data-testid="mic-recording"
      >
        <template v-if="voice.submitting.value">
          <span class="size-3 shrink-0 rounded-full border-2 border-accent border-t-transparent animate-spin" aria-hidden="true" />
          <span class="text-sm font-semibold text-white">{{ t.voiceSheet.working }}</span>
        </template>
        <template v-else>
          <span class="size-2.5 shrink-0 animate-pulse rounded-full bg-danger shadow-[0_0_8px_rgba(255,79,90,0.6)]" aria-hidden="true" />
          <span class="w-10 shrink-0 text-sm font-bold tabular-nums text-white" data-testid="mic-seconds">{{ clock }}</span>

          <!-- Dynamic live waveform equalizer bars -->
          <div class="flex h-5 shrink-0 items-center gap-1 overflow-hidden px-1" aria-hidden="true">
            <span
              v-for="(h, idx) in waveformBars"
              :key="idx"
              class="w-1 rounded-full bg-accent transition-[height] duration-75 ease-out"
              :style="{ height: `${h}px` }"
            />
          </div>

          <span class="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-bg" aria-hidden="true">
            <span class="block h-full rounded-full bg-accent transition-[width] duration-100 ease-out" :style="{ width: `${Math.round(rec.level.value * 100)}%` }" />
          </span>
          <button type="button" class="min-h-11 shrink-0 px-2 text-sm text-muted active:scale-95 transition-transform" data-testid="mic-cancel" @click="onCancel">{{ t.common.cancel }}</button>
        </template>
      </div>
    </Transition>

    <Transition
      enter-active-class="transition duration-200 ease-out"
      enter-from-class="translate-y-2 opacity-0"
      enter-to-class="translate-y-0 opacity-100"
      leave-active-class="transition duration-150 ease-in"
      leave-from-class="translate-y-0 opacity-100"
      leave-to-class="translate-y-2 opacity-0"
    >
      <p
        v-if="blocked && visible"
        class="fixed inset-x-3 z-30 mx-auto max-w-md rounded-2xl bg-surface p-3 pr-20 text-sm text-muted shadow-lg shadow-black/50 lg:!bottom-6 lg:!right-24 lg:!left-auto lg:!w-96 lg:!mx-0"
        :style="{ bottom: `calc(3.5rem + env(safe-area-inset-bottom) + ${badge ? '3.5rem' : '0.75rem'})` }"
        data-testid="mic-blocked"
        @click="blocked = false"
      >
        <template v-if="rec.state.value === 'denied'">{{ t.mic.denied }}</template>
        <template v-else>{{ t.mic.unsupported }}</template>
      </p>
    </Transition>

    <!-- Floating Mic Button with Pulsing Radar Effect when Active (Mobile only; desktop triggers via sidebar) -->
    <div
      class="lg:hidden fixed right-3 z-30 flex size-14 items-center justify-center"
      :style="{ bottom: `calc(3.5rem + env(safe-area-inset-bottom) + ${badge ? '3.5rem' : '0.75rem'})` }"
    >
      <!-- Radar pulse waves when actively recording or submitting -->
      <template v-if="active">
        <span class="mic-radar-wave pointer-events-none absolute inset-0 rounded-full bg-accent/35" aria-hidden="true" />
        <span class="mic-radar-wave-delay pointer-events-none absolute inset-0 rounded-full bg-accent/25" aria-hidden="true" />
      </template>

      <button
        type="button"
        :disabled="voice.submitting.value"
        class="relative flex size-14 touch-none select-none items-center justify-center rounded-full shadow-lg shadow-black/50 transition-all duration-200 ease-out active:scale-90 disabled:opacity-85"
        :class="['mic-btn', active && 'is-recording scale-105 shadow-xl']"
        :aria-label="rec.state.value === 'recording' ? t.mic.stop : t.mic.hold"
        data-testid="mic"
        @pointerdown.prevent="down"
        @pointerup="up"
        @contextmenu.prevent
      >
        <svg viewBox="0 0 24 24" class="size-6 transition-transform duration-200" :class="active ? 'scale-110' : ''" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true">
          <rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor" />
          <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
        </svg>
      </button>
    </div>
  </div>
</template>
