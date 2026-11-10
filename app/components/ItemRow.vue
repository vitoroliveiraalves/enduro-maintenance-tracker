<script setup lang="ts">
import { itemLabel } from '~/lib/server-text'
import { stateText, subline } from '~/lib/item-state'
import type { ItemRowJson } from '../../server/domain/item-row'
const { t } = useI18n()

// pendingSync: a service for this item is queued offline; its status updates once it syncs.
const props = defineProps<{ item: ItemRowJson & { pendingSync?: boolean }; to: string }>()
const tone = computed(
  () => ({ overdue: 'text-danger-text', soon: 'text-warn-text', ok: 'text-ok-text', unknown: 'text-muted' })[props.item.status.state],
)
const showStock = computed(() => (props.item.status.state === 'soon' || props.item.status.state === 'overdue') && props.item.stock)
const router = useRouter()
</script>

<template>
  <NuxtLink :to="to" class="mb-2 block bg-surface px-3 py-2.5" :class="{ 'item-overdue': item.status.state === 'overdue' }" data-testid="item-row">
    <div class="flex justify-between gap-2 text-white">
      <span class="brand-slant min-w-0 text-[17px] font-extrabold uppercase leading-tight" style="font-stretch: 105%">{{ itemLabel(item.name) }}</span>
      <span class="flex shrink-0 items-center gap-2 font-tag text-xs font-semibold">
        <span :class="tone" data-testid="item-state">{{ stateText(item) }}</span>
        <button
          v-if="showStock"
          type="button"
          class="-my-2 min-h-11 px-1 text-xs font-bold"
          :class="item.stock === 'in' ? 'text-ok-text' : 'text-danger-text'"
          data-testid="item-stock"
          @click.prevent.stop="router.push({ path: '/shelf', query: { item: item.id } })"
        >
          {{ item.stock === 'in' ? '✓ in stock' : '✗ no spare' }}
        </button>
      </span>
    </div>
    <div class="mt-1 font-tag text-[11px] text-muted" data-testid="item-subline">
      {{ subline(item) }}<span v-if="item.pendingSync" class="text-warn-text" data-testid="item-pending">{{ t.itemRow.pendingDone }}</span>
    </div>
    <ProgressBar :state="item.status.state" :ratio="item.status.ratio" :label="t.itemRow.wear(itemLabel(item.name))" />
  </NuxtLink>
</template>
