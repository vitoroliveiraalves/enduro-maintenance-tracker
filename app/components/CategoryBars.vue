<script setup lang="ts">
import { categoryLabel } from '~/lib/server-text'
const props = defineProps<{
  rows: Array<{ categoryId: string; name: string; cents: number }>
  selectedCategory?: string | null
}>()
const emit = defineEmits<{ select: [name: string] }>()
const { money } = useFormatters()
const max = computed(() => Math.max(1, ...props.rows.map((r) => r.cents)))
</script>

<template>
  <ul class="space-y-2" data-testid="category-bars">
    <li
      v-for="r in rows"
      :key="r.categoryId"
      class="flex cursor-pointer items-center gap-2 rounded-lg px-1.5 py-1 text-[13px] transition hover:bg-surface"
      :class="selectedCategory && selectedCategory !== r.name ? 'opacity-45' : selectedCategory === r.name ? 'bg-surface ring-1 ring-accent' : ''"
      data-testid="category-row"
      @click="emit('select', r.name)"
    >
      <span class="w-[104px] shrink-0 truncate text-text">{{ categoryLabel(r.name) }}</span>
      <span class="h-2 flex-1 overflow-hidden rounded bg-track" aria-hidden="true">
        <i class="block h-full bg-accent" :style="{ width: `${Math.max(2, Math.round((r.cents / max) * 100))}%` }" />
      </span>
      <span class="w-[78px] shrink-0 text-right font-semibold text-white">{{ money(r.cents) }}</span>
    </li>
  </ul>
</template>
