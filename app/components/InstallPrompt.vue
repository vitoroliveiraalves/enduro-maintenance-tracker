<script setup lang="ts">
/**
 * "Add to Home Screen" help. `banner` (bike screen) shows until dismissed,
 * remembered per device; `inline` (Settings) always shows what applies.
 */
const props = defineProps<{ variant: 'banner' | 'inline' }>()
const { mode, install } = useInstall()

const KEY = 'enduro:install-dismissed'
const dismissed = ref(true)
onMounted(() => {
  try {
    dismissed.value = props.variant === 'banner' && localStorage.getItem(KEY) === '1'
  } catch {
    dismissed.value = false
  }
})
function dismiss() {
  dismissed.value = true
  try {
    localStorage.setItem(KEY, '1')
  } catch {
    // private mode / storage blocked: hide for this visit only
  }
}

const visible = computed(() => !dismissed.value && (mode.value === 'ios' || mode.value === 'prompt' || (props.variant === 'inline' && mode.value === 'installed')))
</script>

<template>
  <div
    v-if="visible"
    class="relative rounded-xl bg-surface p-3 text-sm"
    :class="props.variant === 'banner' ? 'mb-3.5 pr-10' : ''"
    data-testid="install-prompt"
  >
    <p v-if="mode === 'installed'" class="text-muted">Enduro Tracker is installed on this device.</p>
    <p v-else-if="mode === 'ios'" class="text-text" data-testid="install-ios">
      To get notifications, add Enduro Tracker to your Home Screen: tap Share
      <svg class="inline-block h-4 w-4 align-[-3px] text-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 3v12M8 7l4-4 4 4M5 12v8h14v-8" /></svg>,
      then 'Add to Home Screen'.
    </p>
    <p v-if="mode === 'ios'" class="mt-1 text-xs text-muted">Don't see Share? On newer iPhones it's in the ⋯ menu.</p>
    <template v-else-if="mode === 'prompt'">
      <p class="text-text">Install Enduro Tracker for quick access and notifications.</p>
      <button type="button" class="mt-2 rounded-lg bg-accent px-3 py-2 text-sm font-bold text-[#111]" data-testid="install-button" @click="install">Install app</button>
    </template>
    <button
      v-if="props.variant === 'banner'"
      type="button"
      class="absolute right-1 top-1 p-2 text-lg leading-none text-muted"
      aria-label="Dismiss"
      data-testid="install-dismiss"
      @click="dismiss"
    >
      ×
    </button>
  </div>
</template>
