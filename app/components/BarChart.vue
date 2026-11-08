<script setup lang="ts">
/** 12 month bars J..D, plain HTML/CSS. `currentMonth` (1..12) is highlighted; later months are dimmed. */
const props = defineProps<{ months: Array<{ month: number; cents: number }>; currentMonth: number; futureAfter: number }>()
const { money } = useFormatters()
const FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const max = computed(() => Math.max(1, ...props.months.map((m) => m.cents)))
const bars = computed(() =>
  props.months.map((m) => ({
    ...m,
    letter: FULL[m.month - 1]![0],
    pct: m.cents > 0 ? Math.max(3, Math.round((m.cents / max.value) * 100)) : 0,
    label: `${FULL[m.month - 1]}: ${money(m.cents)}`,
    cls: m.month === props.currentMonth ? 'bg-accent' : m.month > props.futureAfter ? 'bg-track' : 'bg-accent/55',
  })),
)
</script>

<template>
  <div role="group" aria-label="Spending by month" class="flex h-[110px] items-end gap-[5px] rounded-xl bg-surface px-2.5 pb-5 pt-2.5" data-testid="bar-chart">
    <div v-for="b in bars" :key="b.month" class="relative flex h-full flex-1 items-end">
      <div role="img" :aria-label="b.label" :title="b.label" data-testid="bar" class="w-full rounded-t-[3px]" :class="b.cls" :style="{ height: `${b.pct}%` }" />
      <span aria-hidden="true" class="absolute -bottom-4 left-1/2 -translate-x-1/2 text-[9px]" :class="b.month === currentMonth ? 'font-bold text-accent' : 'text-muted'">{{ b.letter }}</span>
    </div>
  </div>
</template>
