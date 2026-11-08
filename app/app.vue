<script setup lang="ts">
const { pending, failed } = useOffline()
// Room for the pending badge above the tabs, so it never covers the last row.
const badge = computed(() => pending.value > 0 || failed.value.length > 0)
</script>

<template>
  <div class="min-h-dvh bg-bg text-text" :class="badge ? 'pb-28' : 'pb-16'">
    <OfflineBanner />
    <NuxtPage />
    <PendingBadge />
    <BottomTabs />
  </div>
</template>
