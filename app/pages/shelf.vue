<script setup lang="ts">
import { errorMessage } from '~/offline/outbox'
import type { ShelfPart } from '~/lib/shelf'

const { get } = useApi()
const { qty } = useFormatters()
const store = useBikesStore()
const { syncTick } = useOffline()
const route = useRoute()

const tab = ref<'parts' | 'buy'>('parts')
const query = ref('')
const parts = ref<ShelfPart[]>([])
const loaded = ref(false)
const error = ref('')
const sheetOpen = ref(false)
const editing = ref<ShelfPart | null>(null)

/** `?item=<itemId>` (from a maintenance item): only the parts linked to it. */
const itemFilter = computed(() => (typeof route.query.item === 'string' ? route.query.item : ''))

async function load() {
  try {
    parts.value = await get<ShelfPart[]>('/api/parts')
    error.value = ''
  } catch (e) {
    error.value = errorMessage(e, 'Could not load your shelf.', true)
  } finally {
    loaded.value = true
  }
}
onMounted(async () => {
  if (!store.loaded) await store.fetchBikes().catch(() => {})
  await load()
})
watch(syncTick, load)

const shown = computed(() =>
  parts.value.filter((p) => (!itemFilter.value || p.itemIds.includes(itemFilter.value)) && matches(query.value, p.name, p.bikeName, p.notes)),
)
const low = (p: ShelfPart) => p.minHundredths !== null && p.qtyHundredths < p.minHundredths
const empty = (p: ShelfPart) => p.qtyHundredths <= 0

function open(p: ShelfPart | null) {
  editing.value = p
  sheetOpen.value = true
}
</script>

<template>
  <main class="mx-auto max-w-md p-4 pb-24">
    <div class="flex items-center justify-between">
      <h1 class="text-xl font-bold text-white">Shelf</h1>
      <NuxtLink to="/" class="-mr-2 flex min-h-11 items-center px-2 text-sm text-muted" data-testid="shelf-back">Garage</NuxtLink>
    </div>

    <div class="mt-3 grid grid-cols-2 gap-1 rounded-xl bg-surface p-1" role="group" aria-label="Shelf sections">
      <button type="button" class="min-h-11 rounded-lg text-sm font-semibold" :class="tab === 'parts' ? 'bg-accent text-black' : 'text-muted'" :aria-pressed="tab === 'parts'" data-testid="shelf-tab-parts" @click="tab = 'parts'">Shelf</button>
      <button type="button" class="min-h-11 rounded-lg text-sm font-semibold" :class="tab === 'buy' ? 'bg-accent text-black' : 'text-muted'" :aria-pressed="tab === 'buy'" data-testid="shelf-tab-buy" @click="tab = 'buy'">To buy</button>
    </div>

    <template v-if="tab === 'parts'">
      <input
        v-model="query"
        type="search"
        autocomplete="off"
        placeholder="Search parts"
        aria-label="Search parts"
        data-testid="shelf-search"
        class="mt-3 block w-full rounded-xl bg-surface px-3 py-3 text-base text-white outline-none focus:ring-2 focus:ring-accent"
      >
      <p v-if="itemFilter" class="mt-2 text-xs text-muted" data-testid="shelf-item-filter">
        Only parts for one maintenance item ·
        <NuxtLink to="/shelf" class="inline-flex min-h-11 items-center text-accent underline">show all</NuxtLink>
      </p>
      <p v-if="error" role="alert" class="mt-3 text-danger">{{ error }}</p>

      <ul v-if="shown.length" class="mt-3 space-y-2" data-testid="part-list">
        <li v-for="p in shown" :key="p.id">
          <button
            type="button"
            class="flex min-h-14 w-full items-center justify-between gap-3 rounded-xl bg-surface px-4 py-2.5 text-left"
            :class="[empty(p) ? 'opacity-50' : '', p.pending ? 'opacity-70' : '']"
            :disabled="p.pending"
            data-testid="part-row"
            @click="open(p)"
          >
            <span class="min-w-0">
              <span class="block truncate font-semibold text-white">{{ p.name }}</span>
              <span class="block truncate text-xs text-muted">
                {{ p.bikeName ?? 'Any bike' }}<template v-if="p.pending || p.pendingSync"> · Waiting to sync</template>
              </span>
            </span>
            <span class="shrink-0 text-lg font-bold" :class="low(p) ? 'text-danger-text' : 'text-white'" data-testid="part-qty" :data-low="low(p)">{{ qty(p.qtyHundredths, p.unit) }}</span>
          </button>
        </li>
      </ul>
      <p v-else-if="loaded && !error" class="mt-4 text-muted" data-testid="shelf-empty">
        {{ parts.length ? 'No part matches.' : 'Nothing on the shelf yet. Add the spares you keep.' }}
      </p>

      <button type="button" class="mt-5 block w-full rounded-xl bg-accent py-3 text-center font-bold text-black" data-testid="add-part" @click="open(null)">+ Add part</button>
    </template>

    <p v-else class="mt-4 text-muted" data-testid="buy-panel">Your shopping list shows here.</p>

    <PartSheet v-model:open="sheetOpen" :part="editing" :bikes="store.bikes" @changed="load" />
  </main>
</template>
