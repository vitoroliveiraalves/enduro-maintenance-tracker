<script setup lang="ts">
/**
 * Asks once to install the app, on any signed-in screen a moment after it opens.
 * Chrome/Android: "Install" opens the browser's own install dialog.
 * iPhone/iPad Safari has no install API: it shows the Share → Add to Home Screen steps.
 * "Not now" snoozes it for 14 days on this device; Settings always has the same help.
 */
const route = useRoute()
const { mode, install } = useInstall()

const KEY = 'enduro:install-popup-snoozed-at'
const SNOOZE_MS = 14 * 24 * 60 * 60 * 1000
const DELAY_MS = 1500
// Not before sign-in, and not over a screen the rider is busy on.
const HIDDEN = ['/login', '/register', '/invoice']

const open = ref(false)
let shown = false
let timer: ReturnType<typeof setTimeout> | null = null

function snoozed() {
  try {
    const at = Number(localStorage.getItem(KEY))
    return at > 0 && Date.now() - at < SNOOZE_MS
  } catch {
    return false
  }
}
function snooze() {
  try {
    localStorage.setItem(KEY, String(Date.now()))
  } catch {
    // private mode / storage blocked: asked again next visit
  }
}

const eligible = computed(() => (mode.value === 'prompt' || mode.value === 'ios') && !HIDDEN.includes(route.path))
function schedule() {
  if (timer) clearTimeout(timer)
  timer = null
  if (shown || !eligible.value || snoozed()) return
  timer = setTimeout(() => {
    if (shown || !eligible.value || snoozed()) return
    shown = true
    open.value = true
  }, DELAY_MS)
}
onMounted(schedule)
watch(eligible, schedule)
onBeforeUnmount(() => timer && clearTimeout(timer))

// Closed any way (Not now, ×, backdrop, Escape, Android back) without installing: snooze.
watch(open, (isOpen) => {
  if (!isOpen && mode.value !== 'installed') snooze()
})
watch(mode, (m) => {
  if (m === 'installed' || m === 'none') open.value = false
})

async function onInstall() {
  await install()
  open.value = false
}
</script>

<template>
  <Sheet v-model:open="open" title="Install Enduro Tracker" testid="install-popup">
    <template v-if="mode === 'ios'">
      <p class="text-sm text-text">Add it to your Home Screen to open it like an app, use it offline in the garage, and get service reminders.</p>
      <ol class="mt-3 space-y-2 text-sm text-text" data-testid="install-popup-ios">
        <li class="flex items-center gap-3">
          <span class="flex size-7 shrink-0 items-center justify-center rounded-full bg-bg text-xs font-bold text-accent-text">1</span>
          <span>Tap Share
            <svg class="inline-block h-4 w-4 align-[-3px] text-accent-text" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 3v12M8 7l4-4 4 4M5 12v8h14v-8" /></svg>
            in Safari (on newer iPhones it's in the ⋯ menu).</span>
        </li>
        <li class="flex items-center gap-3">
          <span class="flex size-7 shrink-0 items-center justify-center rounded-full bg-bg text-xs font-bold text-accent-text">2</span>
          <span>Choose 'Add to Home Screen'.</span>
        </li>
        <li class="flex items-center gap-3">
          <span class="flex size-7 shrink-0 items-center justify-center rounded-full bg-bg text-xs font-bold text-accent-text">3</span>
          <span>Open Enduro from your Home Screen.</span>
        </li>
      </ol>
      <button type="button" class="mt-4 min-h-11 w-full rounded-xl bg-accent py-3 text-sm font-bold text-on-accent" data-testid="install-popup-ok" @click="open = false">Got it</button>
    </template>
    <template v-else>
      <p class="text-sm text-text">Open it like an app from your home screen, use it offline in the garage, and get service reminders.</p>
      <button type="button" class="mt-4 min-h-11 w-full rounded-xl bg-accent py-3 text-sm font-bold text-on-accent" data-testid="install-popup-install" @click="onInstall">Install</button>
      <button type="button" class="mt-2 min-h-11 w-full rounded-xl py-3 text-sm font-semibold text-muted" data-testid="install-popup-later" @click="open = false">Not now</button>
    </template>
  </Sheet>
</template>
