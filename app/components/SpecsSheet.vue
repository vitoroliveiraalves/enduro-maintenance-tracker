<script setup lang="ts">
import { itemLabel } from '~/lib/server-text'

export type BikeSpecEntry = {
  id: string
  itemId: string
  itemName: string
  title: string
  body: string
  specs: Array<{ label: string; value: string }>
}

const props = defineProps<{
  bikeId: string
  bikeName: string
  specs: BikeSpecEntry[]
  items: Array<{ id: string; name: string }>
}>()

const open = defineModel<boolean>('open', { default: false })
const { t } = useI18n()
const router = useRouter()

const query = ref('')

type FlattenedSpec = {
  noteId: string
  itemId: string
  itemName: string
  noteTitle: string
  label: string
  value: string
}

const allSpecs = computed<FlattenedSpec[]>(() => {
  const list: FlattenedSpec[] = []
  for (const n of props.specs) {
    for (const s of n.specs) {
      if (s.label.trim() || s.value.trim()) {
        list.push({
          noteId: n.id,
          itemId: n.itemId,
          itemName: n.itemName,
          noteTitle: n.title,
          label: s.label,
          value: s.value,
        })
      }
    }
  }
  return list
})

const filteredSpecs = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return allSpecs.value
  return allSpecs.value.filter(
    (s) =>
      s.label.toLowerCase().includes(q) ||
      s.value.toLowerCase().includes(q) ||
      itemLabel(s.itemName).toLowerCase().includes(q) ||
      s.noteTitle.toLowerCase().includes(q),
  )
})

function goToItem(itemId: string) {
  open.value = false
  router.push(`/bikes/${props.bikeId}/items/${itemId}`)
}
</script>

<template>
  <Sheet v-model:open="open" :title="t.bike.specs" testid="specs-sheet">
    <div v-if="allSpecs.length" class="space-y-3">
      <div class="relative">
        <input
          v-model="query"
          type="search"
          :placeholder="t.bike.searchSpecs"
          autocomplete="off"
          data-testid="specs-search-input"
          class="w-full rounded-xl bg-bg px-3 py-2.5 text-sm text-white placeholder-muted outline-none focus:ring-2 focus:ring-accent"
        >
      </div>

      <div v-if="filteredSpecs.length" class="divide-y divide-white/5 rounded-xl bg-surface p-1" data-testid="specs-list">
        <div
          v-for="(s, idx) in filteredSpecs"
          :key="`${s.noteId}-${idx}`"
          class="flex items-center justify-between gap-3 p-2.5 transition hover:bg-white/5 cursor-pointer rounded-lg"
          data-testid="spec-row"
          @click="goToItem(s.itemId)"
        >
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-1.5">
              <span class="rounded bg-bg px-1.5 py-0.5 font-tag text-[10px] uppercase tracking-wider text-muted truncate">
                {{ itemLabel(s.itemName) }}
              </span>
            </div>
            <div class="mt-1 text-sm font-semibold text-white truncate" data-testid="spec-label">{{ s.label }}</div>
          </div>
          <div class="shrink-0 text-right font-tag text-base font-bold text-accent-text tabular-nums" data-testid="spec-value">
            {{ s.value }}
          </div>
        </div>
      </div>
      <p v-else class="py-6 text-center text-xs text-muted" data-testid="specs-empty-search">
        {{ t.shelf.noMatch }}
      </p>
    </div>

    <div v-else class="py-4 text-center space-y-4" data-testid="specs-empty">
      <div class="mx-auto flex size-12 items-center justify-center rounded-full bg-surface text-muted">
        <Icon name="wrench" :size="24" />
      </div>
      <div>
        <h3 class="text-sm font-bold text-white">{{ t.bike.noSpecs }}</h3>
        <p class="mt-1 text-xs text-muted leading-relaxed max-w-xs mx-auto">
          {{ t.bike.noSpecsHint }}
        </p>
      </div>

      <div v-if="props.items.length" class="text-left pt-2">
        <div class="text-[10px] uppercase tracking-wider font-tag text-muted mb-2 px-1">
          {{ t.bike.maintenance }}
        </div>
        <div class="space-y-1.5 max-h-48 overflow-y-auto pr-1">
          <button
            v-for="it in props.items"
            :key="it.id"
            type="button"
            class="w-full flex items-center justify-between rounded-xl bg-surface px-3 py-2.5 text-xs font-semibold text-text hover:bg-surface/80 hover:text-white transition"
            data-testid="item-spec-target"
            @click="goToItem(it.id)"
          >
            <span>{{ itemLabel(it.name) }}</span>
            <span class="text-accent-text text-[11px] font-tag">+ {{ t.itemNotes.add }}</span>
          </button>
        </div>
      </div>
    </div>
  </Sheet>
</template>
