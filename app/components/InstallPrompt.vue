<script setup lang="ts">
const { t } = useI18n()
/** Install help in Settings: always shows what applies (the popup is InstallPopup). */
const { mode, install } = useInstall()
const visible = computed(() => mode.value !== 'none')
</script>

<template>
  <div v-if="visible" class="rounded-xl bg-surface p-3 text-sm" data-testid="install-prompt">
    <p v-if="mode === 'installed'" class="text-muted">{{ t.install.installed }}</p>
    <p v-else-if="mode === 'ios'" class="text-text" data-testid="install-ios">
      {{ t.install.iosNotifA }}
      <svg class="inline-block h-4 w-4 align-[-3px] text-accent-text" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 3v12M8 7l4-4 4 4M5 12v8h14v-8" /></svg>
      {{ t.install.iosNotifB }}
    </p>
    <p v-if="mode === 'ios'" class="mt-1 text-xs text-muted">{{ t.install.noShare }}</p>
    <template v-else-if="mode === 'prompt'">
      <p class="text-text">{{ t.install.promptText }}</p>
      <button type="button" class="mt-2 min-h-11 rounded-lg bg-accent px-3 py-2 text-sm font-bold text-on-accent" data-testid="install-button" @click="install">{{ t.install.installApp }}</button>
    </template>
  </div>
</template>
