<script setup lang="ts">
// Shown on every screen while offline. The invoice capture page has its own
// banner (upload needs a connection), so this one steps aside there.
const { t } = useI18n()
const route = useRoute()
const { online } = useOffline()
const visible = computed(() => !online.value && route.path !== '/invoice')
</script>

<template>
  <Transition
    enter-active-class="transition-all duration-200 ease-out"
    enter-from-class="-translate-y-full opacity-0"
    enter-to-class="translate-y-0 opacity-100"
    leave-active-class="transition-all duration-150 ease-in"
    leave-from-class="translate-y-0 opacity-100"
    leave-to-class="-translate-y-full opacity-0"
  >
    <p
      v-if="visible"
      role="status"
      data-testid="app-offline-banner"
      class="sticky top-0 z-30 border-b border-warn/30 bg-surface px-4 py-2 text-center text-xs text-warn-text"
      style="padding-top: max(0.5rem, env(safe-area-inset-top))"
    >
      {{ t.offlineBanner }}
    </p>
  </Transition>
</template>
