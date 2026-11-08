<script setup lang="ts">
// "1 change waiting": writes in the offline outbox. Tap for details; refused
// writes (the server said no once it got them) are listed with the reason and
// a Dismiss button. No Background Sync on iOS, so this also says to keep the
// app open once back online.
const route = useRoute()
const { online, pending, failed, flush, dismiss } = useOffline()

const HIDDEN = ['/login', '/register']
const open = ref(false)
const syncing = ref(false)
const plural = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n} ${many}`)

const visible = computed(() => !HIDDEN.includes(route.path) && (pending.value > 0 || failed.value.length > 0))
const label = computed(() =>
  failed.value.length ? `${plural(failed.value.length, 'change', 'changes')} couldn't be saved` : `${plural(pending.value, 'change', 'changes')} waiting`,
)

async function syncNow() {
  syncing.value = true
  try {
    await flush(true)
  } finally {
    syncing.value = false
  }
}

watch(visible, (v) => {
  if (!v) open.value = false
})
</script>

<template>
  <div v-if="visible">
    <button
      type="button"
      data-testid="pending-badge"
      class="fixed right-3 z-30 rounded-full px-3.5 py-2 text-xs font-bold shadow-lg shadow-black/40"
      :class="failed.length ? 'bg-danger text-[#111]' : 'bg-warn text-[#111]'"
      style="bottom: calc(3.5rem + env(safe-area-inset-bottom) + 0.5rem)"
      @click="open = true"
    >
      {{ label }}
    </button>
    <Sheet v-model:open="open" title="Changes on this phone" testid="pending-sheet">
      <section v-if="failed.length" data-testid="pending-failed">
        <p class="text-sm font-semibold text-danger-text">{{ plural(failed.length, 'change', 'changes') }} couldn't be saved:</p>
        <ul class="mt-2 space-y-2">
          <li v-for="r in failed" :key="r.id" class="rounded-xl bg-bg p-3" data-testid="pending-failed-row">
            <p class="text-sm text-white" data-testid="pending-failed-reason">{{ r.error }}</p>
            <p class="mt-0.5 text-xs text-muted">{{ r.label }}</p>
            <button type="button" class="mt-2 rounded-lg bg-surface px-3 py-1.5 text-[13px] font-semibold text-white" data-testid="pending-dismiss" @click="dismiss(r.id!)">
              Dismiss
            </button>
          </li>
        </ul>
      </section>
      <section v-if="pending" :class="failed.length ? 'mt-4' : ''" data-testid="pending-waiting">
        <p class="text-sm font-semibold text-warn-text">{{ plural(pending, 'change', 'changes') }} waiting to sync</p>
        <p class="mt-1 text-xs text-muted">
          Saved on this phone. {{ online ? 'Sending now — keep the app open for a moment.' : "They're sent when you're back online with the app open." }}
          Don't sign out or clear the browser's data until they're through.
        </p>
        <button
          v-if="online"
          type="button"
          :disabled="syncing"
          class="mt-3 w-full rounded-xl bg-accent py-3 text-sm font-bold text-[#111] disabled:opacity-60"
          data-testid="pending-sync-now"
          @click="syncNow"
        >
          {{ syncing ? 'Syncing…' : 'Sync now' }}
        </button>
      </section>
    </Sheet>
  </div>
</template>
