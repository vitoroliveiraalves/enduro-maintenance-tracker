<script setup lang="ts">
const props = defineProps<{ state: 'overdue' | 'soon' | 'ok' | 'unknown'; ratio: number | null; label: string }>()
const pct = computed(() => Math.round(Math.min(Math.max(props.ratio ?? 0, 0), 1) * 100))
const fill = computed(() => ({ overdue: 'bg-danger', soon: 'bg-warn', ok: 'bg-ok', unknown: 'bg-muted' })[props.state])
</script>

<template>
  <div
    role="progressbar"
    :aria-label="label"
    aria-valuemin="0"
    aria-valuemax="100"
    :aria-valuenow="pct"
    class="mt-[7px] h-1.5 overflow-hidden rounded-[3px] bg-track"
  >
    <i class="block h-full rounded-[3px] transition-[width,background-color] duration-500 ease-out" :class="fill" :style="{ width: `${pct}%` }" />
  </div>
</template>
