<script setup lang="ts">
import { stateText, subline } from '~/lib/item-state'
import type { ItemRowJson } from '../../server/domain/item-row'

const props = defineProps<{ item: ItemRowJson; to: string }>()
const tone = computed(
  () => ({ overdue: 'text-danger-text', soon: 'text-warn-text', ok: 'text-ok-text', unknown: 'text-muted' })[props.item.status.state],
)
</script>

<template>
  <NuxtLink :to="to" class="mb-[7px] block rounded-xl bg-surface px-3 py-2.5" data-testid="item-row">
    <div class="flex justify-between gap-2 text-sm font-semibold text-white">
      <span class="min-w-0">{{ item.name }}</span>
      <span class="shrink-0" :class="tone" data-testid="item-state">{{ stateText(item) }}</span>
    </div>
    <div class="mt-0.5 text-xs text-muted" data-testid="item-subline">{{ subline(item) }}</div>
    <ProgressBar :state="item.status.state" :ratio="item.status.ratio" :label="`${item.name} wear`" />
  </NuxtLink>
</template>
