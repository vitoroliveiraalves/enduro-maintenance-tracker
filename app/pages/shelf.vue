<script setup lang="ts">
import { errorMessage } from '~/offline/outbox'
import type { ManualEntry, ShelfPart, ShoppingList } from '~/lib/shelf'

const { get, mutate } = useApi()
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
const list = ref<ShoppingList>({ auto: [], manual: [] })
const buyOpen = ref(false)
const buyEditing = ref<ManualEntry | null>(null)
const buyBusy = ref(false)

/** `?item=<itemId>` (from a maintenance item): only the parts linked to it. */
const itemFilter = computed(() => (typeof route.query.item === 'string' ? route.query.item : ''))

async function load() {
  try {
    parts.value = await get<ShelfPart[]>('/api/parts')
    list.value = await get<ShoppingList>('/api/shopping')
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

const openManual = computed(() => list.value.manual.filter((e) => !e.doneAt))
const buyCount = computed(() => list.value.auto.length + openManual.value.length)
const autoShown = computed(() => list.value.auto.filter((a) => matches(query.value, a.partName, a.bikeName, a.detail)))
const manualShown = computed(() => list.value.manual.filter((e) => matches(query.value, e.text, e.bikeName)))

function openPart(id: string) {
  const p = parts.value.find((x) => x.id === id)
  if (p) open(p)
}
function addBuy(e: ManualEntry | null) {
  buyEditing.value = e
  buyOpen.value = true
}
async function tick(e: ManualEntry) {
  if (e.pending || buyBusy.value) return
  buyBusy.value = true
  try {
    await mutate(`/api/shopping/${e.id}`, { done: !e.doneAt }, { method: 'PATCH', queue: true })
    await load()
  } catch (err) {
    error.value = errorMessage(err, "Couldn't update the list. Try again.")
  } finally {
    buyBusy.value = false
  }
}

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
      <button type="button" class="min-h-11 rounded-lg text-sm font-semibold" :class="tab === 'parts' ? 'bg-accent text-on-accent' : 'text-muted'" :aria-pressed="tab === 'parts'" data-testid="shelf-tab-parts" @click="tab = 'parts'">Shelf</button>
      <button type="button" class="min-h-11 rounded-lg text-sm font-semibold" :class="tab === 'buy' ? 'bg-accent text-on-accent' : 'text-muted'" :aria-pressed="tab === 'buy'" data-testid="shelf-tab-buy" @click="tab = 'buy'">
        To buy
        <span v-if="buyCount" class="ml-1 rounded-full px-1.5 text-xs font-bold" :class="tab === 'buy' ? 'bg-black/20' : 'bg-accent text-on-accent'" data-testid="buy-count">{{ buyCount }}</span>
      </button>
    </div>

    <input
      v-model="query"
      type="search"
      autocomplete="off"
      placeholder="Search"
      aria-label="Search"
      data-testid="shelf-search"
      class="mt-3 block w-full rounded-xl bg-surface px-3 py-3 text-base text-white outline-none focus:ring-2 focus:ring-accent"
    >

    <template v-if="tab === 'parts'">
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

      <button type="button" class="mt-5 block w-full rounded-xl bg-accent py-3 text-center font-bold text-on-accent" data-testid="add-part" @click="open(null)">+ Add part</button>
    </template>

    <template v-else>
      <p v-if="error" role="alert" class="mt-3 text-danger">{{ error }}</p>
      <section data-testid="buy-panel">
        <ul v-if="autoShown.length" class="mt-3 space-y-2">
          <li v-for="a in autoShown" :key="a.key">
            <button type="button" class="flex min-h-14 w-full flex-col justify-center rounded-xl bg-surface px-4 py-2.5 text-left" data-testid="buy-auto" @click="openPart(a.partId)">
              <span class="flex items-center justify-between gap-3">
                <span class="min-w-0 truncate font-semibold text-white" data-testid="buy-auto-name">{{ a.partName }}</span>
                <span class="shrink-0 text-xs font-semibold" :class="a.reason === 'due' ? 'text-danger-text' : 'text-warn-text'">{{ a.reason === 'due' ? 'Needed' : 'Low' }}</span>
              </span>
              <span class="block truncate text-xs text-muted" data-testid="buy-auto-detail">{{ a.detail }}</span>
              <span v-if="a.bikeName && a.reason !== 'due'" class="block truncate text-xs text-muted">{{ a.bikeName }}</span>
            </button>
          </li>
        </ul>

        <ul v-if="manualShown.length" class="mt-3 space-y-2">
          <li v-for="e in manualShown" :key="e.id" class="flex items-center gap-1 rounded-xl bg-surface pl-1 pr-2" data-testid="buy-manual" :data-done="!!e.doneAt">
            <button
              type="button"
              role="checkbox"
              :aria-checked="!!e.doneAt"
              :aria-label="`Tick ${e.text}`"
              :disabled="e.pending"
              class="flex size-11 shrink-0 items-center justify-center disabled:opacity-40"
              data-testid="buy-tick"
              @click="tick(e)"
            >
              <span class="flex size-6 items-center justify-center rounded-md border-2 text-sm font-bold" :class="e.doneAt ? 'border-accent bg-accent text-on-accent' : 'border-white/30'">{{ e.doneAt ? '✓' : '' }}</span>
            </button>
            <button type="button" class="min-h-14 min-w-0 flex-1 py-2 text-left" :class="e.doneAt ? 'opacity-50' : ''" :disabled="e.pending" data-testid="buy-edit" @click="addBuy(e)">
              <span class="block truncate font-semibold text-white" :class="e.doneAt ? 'line-through' : ''" data-testid="buy-text-row">{{ e.text }}</span>
              <span v-if="e.bikeName || e.pending" class="block truncate text-xs text-muted">{{ e.bikeName ?? '' }}<template v-if="e.pending"><template v-if="e.bikeName"> · </template>Waiting to sync</template></span>
            </button>
          </li>
        </ul>

        <p v-if="loaded && !error && !autoShown.length && !manualShown.length" class="mt-4 text-muted" data-testid="buy-empty">
          {{ list.auto.length || list.manual.length ? 'Nothing matches.' : 'Nothing to buy. Parts running low or needed for a service show up here.' }}
        </p>
      </section>
      <button type="button" class="mt-5 block w-full rounded-xl bg-accent py-3 text-center font-bold text-on-accent" data-testid="buy-add" @click="addBuy(null)">+ Add to list</button>
    </template>

    <PartSheet v-model:open="sheetOpen" :part="editing" :bikes="store.bikes" @changed="load" />
    <ShoppingSheet v-model:open="buyOpen" :entry="buyEditing" :bikes="store.bikes" :parts="parts" @changed="load" />
  </main>
</template>
