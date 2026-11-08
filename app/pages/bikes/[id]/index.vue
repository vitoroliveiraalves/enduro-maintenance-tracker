<script setup lang="ts">
import { parseDecimal } from '~/lib/parse-number'
import type { ItemRowJson } from '../../../../server/domain/item-row'

type Detail = {
  bike: { id: string; name: string; year: number }
  latestReading: { at: string; hoursTenths: number; km: number } | null
  items: ItemRowJson[]
}

const route = useRoute()
const id = route.params.id as string
const { get, mutate } = useApi()
const { hours, km, weekdayDay } = useFormatters()
const store = useBikesStore()
const data = ref<Detail | null>(null)
const error = ref('')
const sheetOpen = ref(false)

onMounted(async () => {
  try {
    data.value = await get<Detail>(`/api/bikes/${id}`)
    store.setLast(id)
  } catch {
    error.value = 'Bike not found.'
  }
})

function onSaved(detail: Record<string, unknown>) {
  data.value = detail as unknown as Detail
}

const lastRide = computed(() => (data.value?.latestReading ? `Last ride: ${weekdayDay(data.value.latestReading.at)}` : 'No rides yet'))

// Empty bike: a small inline form to add the first item.
const newName = ref('')
const newHours = ref('')
const newKm = ref('')
const newMonths = ref('')
const addError = ref('')
const adding = ref(false)

async function addItem() {
  if (adding.value) return
  addError.value = ''
  const num = (t: string) => (t.trim() ? parseDecimal(t) : undefined)
  const [h, k, m] = [num(newHours.value), num(newKm.value), num(newMonths.value)]
  if (!newName.value.trim()) return void (addError.value = 'Give the item a name.')
  if ([h, k, m].some((v) => v === null || (v !== undefined && v <= 0))) return void (addError.value = 'Enter intervals as numbers above zero.')
  if (h === undefined && k === undefined && m === undefined) return void (addError.value = 'Set at least one interval (hours, km or months).')
  adding.value = true
  try {
    await mutate('/api/items', {
      bikeId: id,
      name: newName.value.trim(),
      ...(h != null ? { everyHoursTenths: Math.round(h * 10) } : {}),
      ...(k != null ? { everyKm: Math.round(k) } : {}),
      ...(m != null ? { everyMonths: Math.round(m) } : {}),
    })
    data.value = await get<Detail>(`/api/bikes/${id}`)
    newName.value = newHours.value = newKm.value = newMonths.value = ''
  } catch (e) {
    const { statusMessage, data: d } = e as { statusMessage?: string; data?: { statusMessage?: string } }
    addError.value = d?.statusMessage ?? statusMessage ?? 'Could not add the item. Try again.'
  } finally {
    adding.value = false
  }
}

const field = 'mt-1 block w-full rounded-xl bg-bg px-3 py-3 text-base normal-case text-white outline-none focus:ring-2 focus:ring-accent'
</script>

<template>
  <main class="mx-auto max-w-md px-4 pb-6 pt-[18px]">
    <p v-if="error" role="alert" class="text-danger">{{ error }}</p>
    <div class="flex items-center justify-between text-[13px] text-muted">
      <NuxtLink to="/" class="-m-2 p-2">‹ Garage</NuxtLink>
      <NuxtLink to="/settings" class="-m-2 p-2 text-base" aria-label="Settings" data-testid="settings-link">⚙︎</NuxtLink>
    </div>
    <template v-if="data">
      <h1 class="mb-0.5 mt-1.5 text-xl font-bold text-white" data-testid="bike-name">{{ data.bike.name }}</h1>
      <div class="text-xs text-muted" data-testid="last-ride">{{ lastRide }}</div>
      <div v-if="data.latestReading" class="mb-3.5 mt-3 flex gap-2.5">
        <MeterCard label="Hours" :value="hours(data.latestReading.hoursTenths)" testid="hours-value" />
        <MeterCard label="Km" :value="km(data.latestReading.km).replace(/ km$/, '')" testid="km-value" />
      </div>
      <button
        type="button"
        class="mb-3.5 block w-full rounded-xl bg-accent p-[11px] text-sm font-bold text-[#111]"
        :class="data.latestReading ? '' : 'mt-3'"
        data-testid="log-ride"
        @click="sheetOpen = true"
      >
        + Log ride / update meters
      </button>
      <LogRideSheet v-model:open="sheetOpen" :bike-id="data.bike.id" :current="data.latestReading" @saved="onSaved" />

      <template v-if="data.items.length">
        <h2 class="mb-1.5 mt-3 text-[11px] uppercase tracking-[0.08em] text-muted">Maintenance · due soonest first</h2>
        <ItemRow v-for="it in data.items" :key="it.id" :item="it" :to="`/bikes/${id}/items/${it.id}`" />
      </template>

      <section v-else class="mt-3 rounded-xl bg-surface p-3" data-testid="empty-items">
        <p class="text-sm font-semibold text-white">No maintenance items — add one</p>
        <form class="mt-2" @submit.prevent="addItem" @input="addError = ''">
          <label class="block text-[11px] uppercase tracking-wider text-muted">
            Name
            <input v-model="newName" autocomplete="off" maxlength="80" data-testid="new-item-name" :class="field">
          </label>
          <div class="mt-3 flex gap-2.5">
            <label class="flex-1 text-[11px] uppercase tracking-wider text-muted">
              Every h
              <input v-model="newHours" inputmode="decimal" autocomplete="off" data-testid="new-item-hours" :class="field">
            </label>
            <label class="flex-1 text-[11px] uppercase tracking-wider text-muted">
              Every km
              <input v-model="newKm" inputmode="decimal" autocomplete="off" data-testid="new-item-km" :class="field">
            </label>
            <label class="flex-1 text-[11px] uppercase tracking-wider text-muted">
              Every mo
              <input v-model="newMonths" inputmode="decimal" autocomplete="off" data-testid="new-item-months" :class="field">
            </label>
          </div>
          <p v-if="addError" role="alert" class="mt-2 text-sm text-danger" data-testid="new-item-error">{{ addError }}</p>
          <button type="submit" :disabled="adding" class="mt-3 w-full rounded-xl bg-accent py-3 text-sm font-bold text-[#111] disabled:opacity-60" data-testid="new-item-save">Add item</button>
        </form>
      </section>
    </template>
  </main>
</template>
