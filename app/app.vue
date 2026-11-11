<script setup lang="ts">
const { pending, failed, online, voiceWaiting, voiceReady } = useOffline()
const voice = useVoice()
const route = useRoute()

// Room for the pending badge above the tabs, so it never covers the last row.
const badge = computed(() => pending.value > 0 || failed.value.length > 0 || voiceWaiting.value > 0 || voiceReady.value.length > 0)
// …and for the mic on the screens that show it.
const mic = computed(() => voice.available.value && /^\/(history|costs|shelf)?$|^\/bikes\/[0-9a-f-]{36}$/.test(route.path))
// Tabs (3.5rem) + home indicator, plus the pending badge and the mic when shown.
const bottomPad = computed(() => `calc(${4 + (badge.value ? 3 : 0) + (mic.value ? 4 : 0)}rem + env(safe-area-inset-bottom))`)
// Notch / status bar in the installed app; the offline banner pads itself.
const topInset = computed(() => online.value || route.path === '/invoice')
</script>

<template>
  <div class="app-layout min-h-dvh bg-bg text-text lg:flex lg:flex-row lg:!pb-0" :style="{ paddingBottom: bottomPad }">
    <DesktopSidebar />
    <div class="min-w-0 lg:flex-1">
      <div v-if="topInset" aria-hidden="true" style="height: env(safe-area-inset-top)" class="lg:hidden" />
      <OfflineBanner />
      <PendingInvoices />
      <NuxtPage />
    </div>
    <PendingBadge />
    <MicButton />
    <VoiceSheet />
    <Toast />
    <InstallPopup />
    <BottomTabs />
  </div>
</template>

<style scoped>
@media (min-width: 1024px) {
  .app-layout {
    padding-bottom: 0 !important;
  }
}
</style>
