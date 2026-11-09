<script setup lang="ts">
// Shown on every screen while offline. The invoice capture page has its own
// banner (upload needs a connection), so this one steps aside there.
const route = useRoute()
const { online } = useOffline()
const visible = computed(() => !online.value && route.path !== '/invoice')
</script>

<template>
  <p
    v-if="visible"
    role="status"
    data-testid="app-offline-banner"
    class="sticky top-0 z-30 border-b border-warn/30 bg-surface px-4 py-2 text-center text-xs text-warn-text"
    style="padding-top: max(0.5rem, env(safe-area-inset-top))"
  >
    Offline — showing your last synced data. Rides, services and expenses save on this phone and sync when you're back.
  </p>
</template>
