<script setup lang="ts">
// Grey placeholder rows while a screen waits for its first data (network first, so this can be a few
// seconds on a bad connection). Same surface token as the real rows; still under reduced motion.
const { t } = useI18n()
withDefaults(defineProps<{ rows?: number; height?: string }>(), { rows: 3, height: 'h-16' })
</script>

<template>
  <div role="status" aria-busy="true" class="space-y-2" data-testid="skeleton">
    <span class="sr-only">{{ t.common.loading }}</span>
    <div v-for="i in rows" :key="i" class="bg-surface motion-safe:animate-pulse" :class="height" aria-hidden="true" />
  </div>
</template>
