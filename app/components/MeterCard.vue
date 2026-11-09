<script setup lang="ts">
defineProps<{ label: string; value: string; testid?: string }>()
</script>

<template>
  <div class="flex-1 border-[1.5px] border-text px-3 py-2.5 font-tag">
    <span class="text-[10px] uppercase tracking-[0.12em] text-muted">{{ label }}</span>
    <b class="block text-[30px] font-semibold leading-tight text-white" :data-testid="testid">{{ value }}</b>
  </div>
</template>
