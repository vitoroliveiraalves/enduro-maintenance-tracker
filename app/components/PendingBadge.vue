<script setup lang="ts">
// "1 change waiting": writes in the offline outbox. Tap for details:
// - refused writes (the server said no, or retries ran out) with the reason, Retry and Dismiss;
// - waiting writes, each with "Discard this change" (confirmed in the sheet).
// No Background Sync on iOS, so it also says to keep the app open once back online.
import type { PendingItem } from '~/composables/useOffline'

const route = useRoute()
const { online, pending, waiting, failed, voiceWaiting, voiceReady, flush, remove, retry } = useOffline()
const voice = useVoice()

const HIDDEN = ['/login', '/register']
const open = ref(false)
const syncing = ref(false)
const confirmKey = ref<string | null>(null)
const plural = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n} ${many}`)

const visible = computed(() => !HIDDEN.includes(route.path) && (pending.value > 0 || failed.value.length > 0 || voiceWaiting.value > 0 || voiceReady.value.length > 0))
const label = computed(() => {
  if (failed.value.length) return `${plural(failed.value.length, 'change', 'changes')} couldn't be saved`
  if (voiceReady.value.length) return voiceReady.value.length === 1 ? 'Voice note ready' : `${voiceReady.value.length} voice notes ready`
  const parts = [
    ...(pending.value ? [plural(pending.value, 'change', 'changes')] : []),
    ...(voiceWaiting.value ? [plural(voiceWaiting.value, 'voice note', 'voice notes')] : []),
  ]
  return `${parts.join(', ')} waiting`
})

/** A ready voice note and nothing else to show: the tap opens it straight away. */
function tap() {
  if (voiceReady.value.length && !failed.value.length && !pending.value && !voiceWaiting.value) return void openVoice(voiceReady.value[0]!)
  open.value = true
}
function openVoice(v: (typeof voiceReady.value)[number]) {
  open.value = false
  void voice.openReady(v)
}

async function syncNow() {
  syncing.value = true
  try {
    await flush(true)
  } finally {
    syncing.value = false
  }
}

async function discard(item: PendingItem) {
  confirmKey.value = null
  await remove(item)
}

watch(visible, (v) => {
  if (!v) open.value = false
})
watch(open, () => (confirmKey.value = null))
</script>

<template>
  <div v-if="visible">
    <button
      type="button"
      data-testid="pending-badge"
      class="fixed right-3 z-30 rounded-full px-3.5 py-2 text-xs font-bold shadow-lg shadow-black/40"
      :class="failed.length ? 'bg-danger text-on-danger' : 'bg-warn text-on-danger'"
      style="bottom: calc(3.5rem + env(safe-area-inset-bottom) + 0.5rem)"
      @click="tap"
    >
      {{ label }}
    </button>
    <Sheet v-model:open="open" title="Changes on this phone" testid="pending-sheet">
      <section v-if="failed.length" data-testid="pending-failed">
        <p class="text-sm font-semibold text-danger-text">{{ plural(failed.length, 'change', 'changes') }} couldn't be saved:</p>
        <ul class="mt-2 space-y-2">
          <li v-for="r in failed" :key="r.key" class="rounded-xl bg-bg p-3" data-testid="pending-failed-row">
            <p class="text-sm text-white" data-testid="pending-failed-reason">{{ r.error }}</p>
            <p class="mt-0.5 text-xs text-muted">{{ r.label }}</p>
            <div class="mt-2 flex gap-2">
              <button
                v-if="online"
                type="button"
                class="rounded-lg bg-accent px-3 py-1.5 text-[13px] font-semibold text-on-accent"
                data-testid="pending-retry"
                @click="retry(r)"
              >
                Retry
              </button>
              <button type="button" class="rounded-lg bg-surface px-3 py-1.5 text-[13px] font-semibold text-white" data-testid="pending-dismiss" @click="remove(r)">
                Dismiss
              </button>
            </div>
          </li>
        </ul>
      </section>
      <section v-if="voiceReady.length || voiceWaiting" :class="failed.length ? 'mt-4' : ''" data-testid="pending-voice">
        <ul class="space-y-2">
          <li v-for="v in voiceReady" :key="v.id" class="flex items-center justify-between gap-2 rounded-xl bg-bg px-3 py-2">
            <span class="text-sm text-white">Voice note ready</span>
            <button type="button" class="min-h-11 shrink-0 rounded-lg bg-accent px-3 text-[13px] font-semibold text-on-accent" data-testid="pending-voice-open" @click="openVoice(v)">Open</button>
          </li>
        </ul>
        <p v-if="voiceWaiting" class="mt-2 text-xs text-muted">{{ plural(voiceWaiting, 'voice note', 'voice notes') }} kept on this phone, answered when you're back online with the app open.</p>
      </section>
      <section v-if="pending" :class="failed.length || voiceReady.length || voiceWaiting ? 'mt-4' : ''" data-testid="pending-waiting">
        <p class="text-sm font-semibold text-warn-text">{{ plural(pending, 'change', 'changes') }} waiting to sync</p>
        <p class="mt-1 text-xs text-muted">
          Saved on this phone. {{ online ? 'Sending now — keep the app open for a moment.' : "They're sent when you're back online with the app open." }}
          Don't sign out or clear the browser's data until they're through.
        </p>
        <ul class="mt-2 space-y-2">
          <li v-for="w in waiting" :key="w.key" class="flex items-center justify-between gap-2 rounded-xl bg-bg px-3 py-2" data-testid="pending-row">
            <span class="min-w-0 text-sm text-white">{{ w.label }}</span>
            <span v-if="confirmKey === w.key" class="flex shrink-0 gap-3 text-[13px]">
              <button type="button" class="font-bold text-danger" data-testid="pending-discard-confirm" @click="discard(w)">Yes, discard</button>
              <button type="button" class="text-muted" @click="confirmKey = null">Keep</button>
            </span>
            <button v-else type="button" class="shrink-0 text-[13px] text-muted" data-testid="pending-discard" @click="confirmKey = w.key">
              Discard this change
            </button>
          </li>
        </ul>
        <button
          v-if="online"
          type="button"
          :disabled="syncing"
          class="mt-3 w-full rounded-xl bg-accent py-3 text-sm font-bold text-on-accent disabled:opacity-60"
          data-testid="pending-sync-now"
          @click="syncNow"
        >
          {{ syncing ? 'Syncing…' : 'Sync now' }}
        </button>
      </section>
    </Sheet>
  </div>
</template>
