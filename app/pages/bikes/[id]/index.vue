<script setup lang="ts">
import { parseDecimal } from '~/lib/parse-number'
import { dueChips, type DueChip } from '~/lib/reminders'
import { rideToast } from '~/lib/save-toast'
import { errorMessage } from '~/offline/outbox'
import type { ItemRowJson } from '../../../../server/domain/item-row'

type Detail = {
  bike: { id: string; name: string; year: number }
  latestReading: { id?: string; at: string; hoursTenths: number; km: number; pending?: boolean } | null
  items: Array<ItemRowJson & { pendingSync?: boolean }>
}

const route = useRoute()
const id = route.params.id as string
const { get, mutate } = useApi()
const { hours, km, weekdayDay } = useFormatters()
const store = useBikesStore()
const data = ref<Detail | null>(null)
const error = ref('')
const sheetOpen = ref(false)
const chips = ref<DueChip[]>([])
const { syncTick } = useOffline()

async function load() {
  try {
    data.value = await get<Detail>(`/api/bikes/${id}`)
    error.value = ''
    store.setLast(id)
  } catch (e) {
    // Offline and never opened on this device: say so, not "not found".
    if (!data.value) error.value = errorMessage(e, 'Bike not found.', true)
  }
}

onMounted(async () => {
  // Reminders for this bike (or all bikes) due in 30 days or less; never blocks the screen.
  get<Array<{ id: string; title: string; dueOn: string }>>(`/api/reminders?bikeId=${id}`)
    .then((list) => (chips.value = dueChips(list)))
    .catch(() => {})
  await load()
})
// A flush sent queued writes: show the server's view (status recomputed there).
watch(syncTick, load)

async function renameBike(name: string) {
  await mutate(`/api/bikes/${id}`, { name }, { method: 'PATCH', queue: true })
  await load()
  toast.show(`Renamed to ${name}`)
}
async function removeBike() {
  const name = data.value?.bike.name ?? 'Bike'
  await mutate(`/api/bikes/${id}`, { archived: true }, { method: 'PATCH', queue: true })
  store.setLast(null)
  toast.show(`${name} removed from the garage`)
  await navigateTo('/')
}

const toast = useToast()
async function onSaved(detail: Record<string, unknown>) {
  const before = data.value?.items ?? []
  const queued = isQueued(detail)
  if (queued) await load() // cached detail + the queued reading on top
  else data.value = detail as unknown as Detail
  const r = data.value?.latestReading
  if (!r) return
  const text = rideToast(before, r, data.value?.items ?? [], queued)
  // A typo is easy to take back while the toast is up (online only: the server checks it's still the latest).
  if (queued || r.pending || !r.id) return toast.show(text)
  const readingId = r.id
  toast.show(text, { action: { label: 'Undo', run: () => undoReading(readingId) } })
}

async function undoReading(readingId: string) {
  try {
    data.value = await mutate<Detail>(`/api/bikes/${id}/latest-reading`, { readingId }, { method: 'DELETE' })
    toast.show('Reading undone')
  } catch (e) {
    toast.show(errorMessage(e, "Couldn't undo the reading. Try again."))
  }
}

const lastRide = computed(() => {
  const r = data.value?.latestReading
  if (!r) return 'No rides yet'
  return `Last ride: ${weekdayDay(r.at)}${r.pending ? ' · waiting to sync' : ''}`
})

// Empty bike: a small inline form to add the first item.
const newName = ref('')
const newHours = ref('')
const newKm = ref('')
const newMonths = ref('')
const addError = ref('')
const addNote = ref('')
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
  addNote.value = ''
  try {
    const res = await mutate('/api/items', {
      bikeId: id,
      name: newName.value.trim(),
      ...(h != null ? { everyHoursTenths: Math.round(h * 10) } : {}),
      ...(k != null ? { everyKm: Math.round(k) } : {}),
      ...(m != null ? { everyMonths: Math.round(m) } : {}),
    }, { queue: true })
    if (isQueued(res)) addNote.value = 'Saved on this phone — the item appears once it syncs.'
    else data.value = await get<Detail>(`/api/bikes/${id}`)
    newName.value = newHours.value = newKm.value = newMonths.value = ''
  } catch (e) {
    addError.value = errorMessage(e, 'Could not add the item. Try again.')
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
      <NuxtLink to="/settings" class="-m-2 flex size-11 items-center justify-center text-lg" aria-label="Settings" data-testid="settings-link">⚙︎</NuxtLink>
    </div>
    <template v-if="data">
      <h1 class="mb-0.5 mt-1.5 text-xl font-bold text-white" data-testid="bike-name">{{ data.bike.name }}</h1>
      <div class="text-xs text-muted" data-testid="last-ride">{{ lastRide }}</div>
      <div v-if="chips.length" class="mt-2 flex flex-wrap gap-1.5">
        <NuxtLink
          v-for="c in chips"
          :key="c.id"
          to="/settings#reminders"
          class="rounded-full px-2.5 py-1 text-xs font-semibold"
          :class="c.tone === 'danger' ? 'bg-danger/15 text-danger-text' : 'bg-warn/15 text-warn-text'"
          data-testid="reminder-chip"
        >
          {{ c.text }}
        </NuxtLink>
      </div>
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
          <p v-else-if="addNote" role="status" class="mt-2 text-sm text-warn-text" data-testid="new-item-queued">{{ addNote }}</p>
          <button type="submit" :disabled="adding" class="mt-3 w-full rounded-xl bg-accent py-3 text-sm font-bold text-[#111] disabled:opacity-60" data-testid="new-item-save">Add item</button>
        </form>
      </section>

      <div class="mt-4"><InstallPrompt variant="banner" /></div>

      <h2 class="mb-1.5 mt-4 text-[11px] uppercase tracking-[0.08em] text-muted">Bike</h2>
      <ManagePanel what="bike" :name="data.bike.name" remove-note="It leaves the garage; its services and costs stay in History and Costs." :rename="renameBike" :remove="removeBike" />
    </template>
  </main>
</template>
