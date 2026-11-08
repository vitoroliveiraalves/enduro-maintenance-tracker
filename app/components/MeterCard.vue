<script setup lang="ts">
defineProps<{ label: string; value: string; testid?: string }>()
</script>

<template>
  <div class="flex-1 rounded-[14px] bg-surface px-3 py-2.5">
    <span class="text-[11px] uppercase tracking-[0.06em] text-muted">{{ label }}</span>
    <b class="block text-2xl font-bold text-white" :data-testid="testid">{{ value }}</b>
  </div>
</template>
