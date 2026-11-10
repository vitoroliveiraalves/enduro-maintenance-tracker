<script setup lang="ts">
import { parseDecimal } from '~/lib/parse-number'
import { dueChips, type DueChip } from '~/lib/reminders'
import { rideToast } from '~/lib/save-toast'
import { errorMessage } from '~/offline/outbox'
import type { ItemRowJson } from '../../../../server/domain/item-row'
const { t } = useI18n()

type Detail = {
  bike: { id: string; name: string; year: number; meters: BikeMeters }
  latestReading: { id?: string; at: string; hoursTenths: number | null; km: number | null; pending?: boolean } | null
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
const correctOpen = ref(false)
const chips = ref<DueChip[]>([])
const { syncTick } = useOffline()

async function load() {
  try {
    data.value = await get<Detail>(`/api/bikes/${id}`)
    error.value = ''
    store.setLast(id)
  } catch (e) {
    // Offline and never opened on this device: say so, not "not found".
    if (!data.value) error.value = errorMessage(e, t.value.bike.notFound, true)
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
  toast.show(t.value.bike.renamed(name))
}
async function removeBike() {
  const name = data.value?.bike.name ?? t.value.bike.fallbackName
  await mutate(`/api/bikes/${id}`, { archived: true }, { method: 'PATCH', queue: true })
  store.setLast(null)
  toast.show(t.value.bike.removed(name))
  await navigateTo('/')
}

// What the bike counts: online only (a queued switch could reorder against queued readings).
const meters = computed<BikeMeters>(() => data.value?.bike.meters ?? 'hours_km')
const hasHours = computed(() => countsHours(meters.value))
const hasKm = computed(() => countsKm(meters.value))
const metersDraft = ref<BikeMeters>('hours_km')
watch(meters, (m) => (metersDraft.value = m), { immediate: true })
const metersBusy = ref(false)
const metersError = ref('')
async function saveMeters() {
  if (metersBusy.value || metersDraft.value === meters.value) return
  metersBusy.value = true
  metersError.value = ''
  try {
    await mutate(`/api/bikes/${id}`, { meters: metersDraft.value }, { method: 'PATCH' })
    await load()
    toast.show(t.value.meters.countsToast(t.value.meters.label[metersDraft.value]))
  } catch (e) {
    metersError.value = errorMessage(e, t.value.bike.metersFailed)
  } finally {
    metersBusy.value = false
  }
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
  toast.show(text, { action: { label: t.value.bike.undo, run: () => undoReading(readingId) } })
}

function onCorrected(detail: Record<string, unknown>) {
  data.value = detail as unknown as Detail
  toast.show(t.value.bike.corrected)
}

async function undoReading(readingId: string) {
  try {
    data.value = await mutate<Detail>(`/api/bikes/${id}/latest-reading`, { readingId }, { method: 'DELETE' })
    toast.show(t.value.bike.undone)
  } catch (e) {
    toast.show(errorMessage(e, t.value.bike.undoFailed))
  }
}

const lastRide = computed(() => {
  const r = data.value?.latestReading
  if (!r) return t.value.bike.noRides
  return t.value.bike.lastRide(weekdayDay(r.at), !!r.pending)
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
  const num = (s: string) => (s.trim() ? parseDecimal(s) : undefined)
  const b = t.value.bike
  const [h, k, m] = [hasHours.value ? num(newHours.value) : undefined, hasKm.value ? num(newKm.value) : undefined, num(newMonths.value)]
  if (!newName.value.trim()) return void (addError.value = b.needItemName)
  if ([h, k, m].some((v) => v === null || (v !== undefined && v <= 0))) return void (addError.value = b.intervalsNumbers)
  if (h === undefined && k === undefined && m === undefined) return void (addError.value = b.needInterval([hasHours.value && b.unitWords.hours, hasKm.value && b.unitWords.km, b.unitWords.months].filter((w): w is string => !!w)))
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
    if (isQueued(res)) addNote.value = b.itemQueued
    else data.value = await get<Detail>(`/api/bikes/${id}`)
    newName.value = newHours.value = newKm.value = newMonths.value = ''
  } catch (e) {
    addError.value = errorMessage(e, b.addFailed)
  } finally {
    adding.value = false
  }
}

const field = 'mt-1 block w-full rounded-xl bg-bg px-3 py-3 text-base normal-case text-white outline-none focus:ring-2 focus:ring-accent'
</script>

<template>
  <main class="mx-auto max-w-md px-4 pb-6 pt-[18px]">
    <p v-if="error" role="alert" class="text-danger-text">{{ error }}</p>
    <div class="flex items-center justify-between text-[13px] text-muted">
      <NuxtLink to="/" class="-m-2 p-2 font-tag text-xs">{{ t.common.garageBack }}</NuxtLink>
      <NuxtLink to="/settings" class="-m-2 flex size-11 items-center justify-center text-lg" :aria-label="t.garage.settings" data-testid="settings-link"><Icon name="settings" :size="22" /></NuxtLink>
    </div>
    <template v-if="data">
      <h1 class="mb-1 mt-2 text-[34px] text-white" data-testid="bike-name">{{ data.bike.name }}</h1>
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
        <MeterCard v-if="hasHours" :label="t.common.hours" :value="data.latestReading.hoursTenths === null ? '—' : hours(data.latestReading.hoursTenths)" testid="hours-value" />
        <MeterCard v-if="hasKm" :label="t.common.km" :value="data.latestReading.km === null ? '—' : km(data.latestReading.km).replace(/ km$/, '')" testid="km-value" />
      </div>
      <button
        type="button"
        class="brand-slant mb-3.5 block min-h-[52px] w-full bg-accent p-[11px] font-black uppercase tracking-[0.04em] text-on-accent" style="font-stretch: 125%"
        :class="data.latestReading ? '' : 'mt-3'"
        data-testid="log-ride"
        @click="sheetOpen = true"
      >
        {{ t.bike.logRide(hasHours && hasKm ? 'meters' : hasHours ? 'hours' : 'km') }}
      </button>
      <LogRideSheet v-model:open="sheetOpen" :bike-id="data.bike.id" :current="data.latestReading" :meters="meters" @saved="onSaved" />
      <button
        v-if="data.latestReading && !data.latestReading.pending"
        type="button"
        class="-mt-1.5 mb-3.5 min-h-11 w-full text-sm font-semibold text-accent-text"
        data-testid="correct-total"
        @click="correctOpen = true"
      >
        {{ t.bike.correct }}
      </button>
      <CorrectTotalSheet v-model:open="correctOpen" :bike-id="data.bike.id" :current="data.latestReading" :meters="meters" @saved="onCorrected" />

      <template v-if="data.items.length">
        <h2 class="mb-2 mt-3 font-tag text-[11px] uppercase tracking-[0.12em] text-muted">{{ t.bike.maintenance }}</h2>
        <ItemRow v-for="it in data.items" :key="it.id" :item="it" :to="`/bikes/${id}/items/${it.id}`" />
      </template>

      <section v-else class="mt-3 rounded-xl bg-surface p-3" data-testid="empty-items">
        <p class="text-sm font-semibold text-white">{{ t.bike.noItems }}</p>
        <form class="mt-2" @submit.prevent="addItem" @input="addError = ''">
          <label class="block text-[11px] uppercase tracking-wider text-muted">
            {{ t.manage.name }}
            <input v-model="newName" autocomplete="off" maxlength="80" data-testid="new-item-name" :class="field">
          </label>
          <div class="mt-3 flex gap-2.5">
            <label v-if="hasHours" class="flex-1 text-[11px] uppercase tracking-wider text-muted">
              {{ t.bike.everyH }}
              <input v-model="newHours" inputmode="decimal" autocomplete="off" data-testid="new-item-hours" :class="field">
            </label>
            <label v-if="hasKm" class="flex-1 text-[11px] uppercase tracking-wider text-muted">
              {{ t.bike.everyKm }}
              <input v-model="newKm" inputmode="decimal" autocomplete="off" data-testid="new-item-km" :class="field">
            </label>
            <label class="flex-1 text-[11px] uppercase tracking-wider text-muted">
              {{ t.bike.everyMo }}
              <input v-model="newMonths" inputmode="decimal" autocomplete="off" data-testid="new-item-months" :class="field">
            </label>
          </div>
          <p v-if="addError" role="alert" class="mt-2 text-sm text-danger-text" data-testid="new-item-error">{{ addError }}</p>
          <p v-else-if="addNote" role="status" class="mt-2 text-sm text-warn-text" data-testid="new-item-queued">{{ addNote }}</p>
          <button type="submit" :disabled="adding" class="mt-3 w-full rounded-xl bg-accent py-3 text-sm font-bold text-on-accent disabled:opacity-60" data-testid="new-item-save">{{ t.bike.addItem }}</button>
        </form>
      </section>

      <h2 class="mb-1.5 mt-4 text-[11px] uppercase tracking-[0.08em] text-muted">{{ t.bike.bikeSection }}</h2>
      <form class="mb-3 rounded-xl bg-surface p-3" data-testid="bike-meters" @submit.prevent="saveMeters">
        <MetersChoice v-model="metersDraft" :disabled="metersBusy" />
        <p class="mt-2 text-xs text-muted">{{ t.bike.metersHint }}</p>
        <p v-if="metersError" role="alert" class="mt-2 text-sm text-danger-text">{{ metersError }}</p>
        <button type="submit" :disabled="metersBusy || metersDraft === meters" class="mt-2 min-h-11 w-full rounded-xl bg-bg text-sm font-semibold text-accent-text disabled:opacity-40" data-testid="bike-meters-save">{{ t.bike.saveCounts }}</button>
      </form>
      <ManagePanel what="bike" :name="data.bike.name" :remove-note="t.bike.removeNote" :rename="renameBike" :remove="removeBike" />
    </template>
    <div v-else-if="!error" class="mt-2" data-testid="bike-loading">
      <div class="h-9 w-2/3 bg-surface motion-safe:animate-pulse" aria-hidden="true" />
      <Skeleton :rows="1" height="h-24" class="mt-4" />
      <Skeleton :rows="4" height="h-16" class="mt-4" />
    </div>
  </main>
</template>
