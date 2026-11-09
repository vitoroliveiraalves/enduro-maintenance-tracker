<script setup lang="ts">
const { pending, failed, online } = useOffline()
// Room for the pending badge above the tabs, so it never covers the last row.
const badge = computed(() => pending.value > 0 || failed.value.length > 0)
// Tabs (3.5rem) + home indicator, plus the pending badge when shown.
const bottomPad = computed(() => `calc(${badge.value ? '7rem' : '4rem'} + env(safe-area-inset-bottom))`)
// Notch / status bar in the installed app; the offline banner pads itself.
const route = useRoute()
const topInset = computed(() => online.value || route.path === '/invoice')
</script>

<template>
  <div class="min-h-dvh bg-bg text-text" :style="{ paddingBottom: bottomPad }">
    <div v-if="topInset" aria-hidden="true" style="height: env(safe-area-inset-top)" />
    <OfflineBanner />
    <PendingInvoices />
    <NuxtPage />
    <PendingBadge />
    <Toast />
    <InstallPopup />
    <BottomTabs />
  </div>
</template>
