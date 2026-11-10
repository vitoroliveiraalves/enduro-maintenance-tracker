<script setup lang="ts">
import { errorMessage } from '~/offline/outbox'
import { serverText } from '~/lib/server-text'
import type { ManualEntry, ShelfPart, ShoppingList } from '~/lib/shelf'
const { t } = useI18n()

const { get, mutate } = useApi()
const { qty } = useFormatters()
const store = useBikesStore()
const { syncTick } = useOffline()
const route = useRoute()

const tab = ref<'parts' | 'buy'>('parts')
const query = ref('')
const bikeFilter = ref('')
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
    error.value = errorMessage(e, t.value.shelf.loadFailed, true)
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
  parts.value.filter(
    (p) =>
      (!itemFilter.value || p.itemIds.includes(itemFilter.value)) &&
      (!bikeFilter.value || p.bikeId === bikeFilter.value || !p.bikeId) &&
      matches(query.value, p.name, p.bikeName, p.notes),
  ),
)
const low = (p: ShelfPart) => p.minHundredths !== null && p.qtyHundredths < p.minHundredths
const empty = (p: ShelfPart) => p.qtyHundredths <= 0

const openManual = computed(() => list.value.manual.filter((e) => !e.doneAt))
const buyCount = computed(() => list.value.auto.length + openManual.value.length)
const autoShown = computed(() =>
  list.value.auto.filter((a) => (!bikeFilter.value || a.bikeId === bikeFilter.value || !a.bikeId) && matches(query.value, a.partName, a.bikeName, a.detail)),
)
const manualShown = computed(() =>
  list.value.manual.filter((e) => (!bikeFilter.value || e.bikeId === bikeFilter.value || !e.bikeId) && matches(query.value, e.text, e.bikeName)),
)

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
    error.value = errorMessage(err, t.value.shelf.updateFailed)
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
      <h1 class="text-xl font-bold text-white">{{ t.shelf.title }}</h1>
      <NuxtLink to="/" class="-mr-2 flex min-h-11 items-center px-2 text-sm text-muted" data-testid="shelf-back">{{ t.shelf.garage }}</NuxtLink>
    </div>

    <div class="mt-3 grid grid-cols-2 gap-1 rounded-xl bg-surface p-1" role="group" :aria-label="t.shelf.sections">
      <button type="button" class="min-h-11 rounded-lg text-sm font-semibold" :class="tab === 'parts' ? 'bg-accent text-on-accent' : 'text-muted'" :aria-pressed="tab === 'parts'" data-testid="shelf-tab-parts" @click="tab = 'parts'">{{ t.shelf.title }}</button>
      <button type="button" class="min-h-11 rounded-lg text-sm font-semibold" :class="tab === 'buy' ? 'bg-accent text-on-accent' : 'text-muted'" :aria-pressed="tab === 'buy'" data-testid="shelf-tab-buy" @click="tab = 'buy'">
        {{ t.shelf.toBuy }}
        <span v-if="buyCount" class="ml-1 rounded-full px-1.5 text-xs font-bold" :class="tab === 'buy' ? 'bg-black/20' : 'bg-accent text-on-accent'" data-testid="buy-count">{{ buyCount }}</span>
      </button>
    </div>

    <div class="mt-3 flex gap-2">
      <input
        v-model="query"
        type="search"
        autocomplete="off"
        :placeholder="t.shelf.search"
        :aria-label="t.shelf.search"
        data-testid="shelf-search"
        class="block min-w-0 flex-1 rounded-xl bg-surface px-3 py-3 text-base text-white outline-none focus:ring-2 focus:ring-accent"
      >
      <select
        v-if="store.bikes.length > 1"
        v-model="bikeFilter"
        data-testid="shelf-bike-filter"
        class="max-w-[45%] truncate rounded-xl bg-surface px-3 py-3 text-sm text-white outline-none focus:ring-2 focus:ring-accent"
      >
        <option value="">{{ t.shelf.allVehicles }}</option>
        <option v-for="b in store.bikes" :key="b.id" :value="b.id">{{ b.name }}</option>
      </select>
    </div>

    <template v-if="tab === 'parts'">
      <p v-if="itemFilter" class="mt-2 text-xs text-muted" data-testid="shelf-item-filter">
        {{ t.shelf.onlyItem }}
        <NuxtLink to="/shelf" class="inline-flex min-h-11 items-center text-accent-text underline">{{ t.shelf.showAll }}</NuxtLink>
      </p>
      <p v-if="error" role="alert" class="mt-3 text-danger-text">{{ error }}</p>

      <Skeleton v-if="!loaded && !error" :rows="4" class="mt-3" />
      <ul v-else-if="shown.length" class="mt-3 space-y-2" data-testid="part-list">
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
                {{ p.bikeName ?? t.shelf.anyBike }}<template v-if="p.pending || p.pendingSync">{{ t.shelf.waiting }}</template>
              </span>
            </span>
            <span class="shrink-0 text-lg font-bold" :class="low(p) ? 'text-danger-text' : 'text-white'" data-testid="part-qty" :data-low="low(p)">{{ qty(p.qtyHundredths, p.unit) }}</span>
          </button>
        </li>
      </ul>
      <p v-else-if="loaded && !error" class="mt-4 text-muted" data-testid="shelf-empty">
        {{ parts.length ? t.shelf.noMatch : t.shelf.empty }}
      </p>

      <button type="button" class="mt-5 block w-full rounded-xl bg-accent py-3 text-center font-bold text-on-accent" data-testid="add-part" @click="open(null)">{{ t.shelf.addPart }}</button>
    </template>

    <template v-else>
      <p v-if="error" role="alert" class="mt-3 text-danger-text">{{ error }}</p>
      <Skeleton v-if="!loaded && !error" :rows="3" class="mt-3" />
      <section data-testid="buy-panel">
        <ul v-if="autoShown.length" class="mt-3 space-y-2">
          <li v-for="a in autoShown" :key="a.key">
            <button type="button" class="flex min-h-14 w-full flex-col justify-center rounded-xl bg-surface px-4 py-2.5 text-left" data-testid="buy-auto" @click="openPart(a.partId)">
              <span class="flex items-center justify-between gap-3">
                <span class="min-w-0 truncate font-semibold text-white" data-testid="buy-auto-name">{{ a.partName }}</span>
                <span class="shrink-0 text-xs font-semibold" :class="a.reason === 'due' ? 'text-danger-text' : 'text-warn-text'">{{ a.reason === 'due' ? t.shelf.needed : t.shelf.low }}</span>
              </span>
              <span class="block truncate text-xs text-muted" data-testid="buy-auto-detail">{{ serverText(a.detail) }}</span>
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
              :aria-label="t.shelf.tick(e.text)"
              :disabled="e.pending"
              class="flex size-11 shrink-0 items-center justify-center disabled:opacity-40"
              data-testid="buy-tick"
              @click="tick(e)"
            >
              <span class="flex size-6 items-center justify-center rounded-md border-2 text-sm font-bold" :class="e.doneAt ? 'border-accent bg-accent text-on-accent' : 'border-white/30'">{{ e.doneAt ? '✓' : '' }}</span>
            </button>
            <button type="button" class="min-h-14 min-w-0 flex-1 py-2 text-left" :class="e.doneAt ? 'opacity-50' : ''" :disabled="e.pending" data-testid="buy-edit" @click="addBuy(e)">
              <span class="block truncate font-semibold text-white" :class="e.doneAt ? 'line-through' : ''" data-testid="buy-text-row">{{ e.text }}</span>
              <span v-if="e.bikeName || e.pending" class="block truncate text-xs text-muted">{{ e.bikeName ?? '' }}<template v-if="e.pending"><template v-if="e.bikeName"> · </template>{{ t.shelf.waitingShort }}</template></span>
            </button>
          </li>
        </ul>

        <p v-if="loaded && !error && !autoShown.length && !manualShown.length" class="mt-4 text-muted" data-testid="buy-empty">
          {{ list.auto.length || list.manual.length ? t.shelf.nothingMatches : t.shelf.nothingToBuy }}
        </p>
      </section>
      <button type="button" class="mt-5 block w-full rounded-xl bg-accent py-3 text-center font-bold text-on-accent" data-testid="buy-add" @click="addBuy(null)">{{ t.shelf.addToList }}</button>
    </template>

    <PartSheet v-model:open="sheetOpen" :part="editing" :bikes="store.bikes" @changed="load" />
    <ShoppingSheet v-model:open="buyOpen" :entry="buyEditing" :bikes="store.bikes" :parts="parts" @changed="load" />
  </main>
</template>
