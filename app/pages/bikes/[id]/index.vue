<script setup lang="ts">
import { parseDecimal } from '~/lib/parse-number'
import { dueChips, type DueChip } from '~/lib/reminders'
import { rideToast } from '~/lib/save-toast'
import { errorMessage } from '~/offline/outbox'
import type { ItemRowJson } from '../../../../server/domain/item-row'
const { t } = useI18n()

export type Detail = {
  bike: {
    id: string
    name: string
    make?: string
    model?: string
    year: number
    stroke: '2T' | '4T'
    vehicleType?: 'motorcycle' | 'car'
    plate?: string | null
    meters: BikeMeters
    premixRatio?: number | null
    notes?: string | null
  }
  latestReading: { id?: string; at: string; hoursTenths: number | null; km: number | null; pending?: boolean } | null
  items: Array<ItemRowJson & { pendingSync?: boolean }>
}

type VehicleReminder = {
  id: string
  title: string
  dueOn: string
  repeatYearly: boolean
  amountCents?: number | null
  provider?: string | null
  policyNumber?: string | null
  bikeId?: string | null
}

const route = useRoute()
const id = route.params.id as string
const { get, mutate } = useApi()
const { hours, km, weekdayDay, dayMonth } = useFormatters()
const store = useBikesStore()
const data = ref<Detail | null>(null)
const error = ref('')
const sheetOpen = ref(false)
const premixOpen = ref(false)
const reminderOpen = ref(false)
const reminderToEdit = ref<VehicleReminder | null>(null)
const bikeReminders = ref<VehicleReminder[]>([])
const chips = ref<DueChip[]>([])
const { syncTick } = useOffline()

function loadReminders() {
  // Reminders for this bike (or all bikes) due in 30 days or less; never blocks the screen.
  get<VehicleReminder[]>(`/api/reminders?bikeId=${id}`)
    .then((list) => {
      bikeReminders.value = list
      chips.value = dueChips(list)
    })
    .catch(() => {})
}

const nonUrgentReminders = computed(() => {
  const chipIds = new Set(chips.value.map((c) => c.id))
  return bikeReminders.value.filter((r) => r.bikeId === id && !chipIds.has(r.id))
})

function editReminder(r: VehicleReminder) {
  reminderToEdit.value = r
  reminderOpen.value = true
}

function openNewReminder() {
  reminderToEdit.value = null
  reminderOpen.value = true
}

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
  loadReminders()
  await load()
})
// A flush sent queued writes: show the server's view (status recomputed there).
watch(syncTick, load)

// What the bike counts: online only (a queued switch could reorder against queued readings).
const meters = computed<BikeMeters>(() => data.value?.bike.meters ?? 'hours_km')
const hasHours = computed(() => countsHours(meters.value))
const hasKm = computed(() => countsKm(meters.value))

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

// Add item form state (for empty bike or adding more items).
const showAddForm = ref(false)
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
    showAddForm.value = false
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
      <NuxtLink :to="`/bikes/${id}/settings`" class="-m-2 flex size-11 items-center justify-center text-lg text-muted hover:text-white" :aria-label="t.bike.settings" data-testid="vehicle-settings-link"><Icon name="settings" :size="22" /></NuxtLink>
    </div>
    <template v-if="data">
      <div class="mb-1 mt-2 flex items-center justify-between gap-2">
        <h1 class="text-[34px] text-white flex items-center gap-2" data-testid="bike-name">
          <span>{{ data.bike.name }}</span>
        </h1>
        <span
          v-if="data.bike.plate"
          class="rounded border border-text/40 bg-bg px-2.5 py-1 font-tag text-xs font-bold tracking-widest text-text"
          data-testid="bike-plate"
        >
          {{ data.bike.plate }}
        </span>
      </div>
      <div class="text-xs text-muted" data-testid="last-ride">{{ lastRide }}</div>
      <div class="mt-2 flex flex-wrap gap-1.5">
        <button
          v-if="data.bike.vehicleType !== 'car' && data.bike.stroke === '2T'"
          type="button"
          class="rounded-full border border-track bg-surface px-2.5 py-1 text-xs font-semibold text-text font-tag transition hover:border-accent"
          data-testid="premix-chip"
          @click="premixOpen = true"
        >
          {{ t.premix.chipLabel(data.bike.premixRatio ?? 50) }}
        </button>
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
        <button
          v-for="r in nonUrgentReminders"
          :key="r.id"
          type="button"
          class="rounded-full border border-track bg-surface px-2.5 py-1 text-xs font-semibold text-text font-tag transition hover:border-accent"
          data-testid="vehicle-obligation-chip"
          @click="editReminder(r)"
        >
          {{ r.title }} · {{ dayMonth(r.dueOn) }}
        </button>
        <button
          type="button"
          class="rounded-full border border-track bg-surface px-2.5 py-1 text-xs font-semibold text-muted font-tag transition hover:border-accent hover:text-text"
          data-testid="add-reminder-chip"
          @click="openNewReminder"
        >
          + {{ t.bike.addReminder }}
        </button>
      </div>
      <div v-if="data.bike.notes" class="mt-2.5 rounded-xl border border-white/5 bg-surface/50 p-3 text-xs leading-relaxed" data-testid="bike-notes-card">
        <span class="block font-tag text-[10px] uppercase tracking-wider text-muted mb-1">{{ t.bike.notes }}</span>
        <p class="whitespace-pre-line text-text">{{ data.bike.notes }}</p>
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

      <template v-if="data.items.length">
        <h2 class="mb-2 mt-3 font-tag text-[11px] uppercase tracking-[0.12em] text-muted">{{ t.bike.maintenance }}</h2>
        <ItemRow v-for="it in data.items" :key="it.id" :item="it" :to="`/bikes/${id}/items/${it.id}`" />

        <div class="mt-3">
          <button
            v-if="!showAddForm"
            type="button"
            class="w-full rounded-xl border border-dashed border-white/20 bg-surface/50 py-3 text-center font-tag text-xs font-bold text-accent-text hover:border-accent hover:bg-surface transition"
            data-testid="open-add-item-btn"
            @click="showAddForm = true"
          >
            + {{ t.bike.addItem }}
          </button>
          <section v-else class="rounded-xl bg-surface p-3.5 border border-track" data-testid="inline-add-item">
            <div class="flex items-center justify-between mb-2">
              <span class="text-xs font-tag font-bold uppercase tracking-wider text-white">{{ t.bike.addItem }}</span>
              <button type="button" class="text-xs text-muted hover:text-white" @click="showAddForm = false">{{ t.common.cancel }}</button>
            </div>
            <form @submit.prevent="addItem" @input="addError = ''">
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
              <div class="mt-3 flex gap-2">
                <button type="button" class="flex-1 rounded-xl border border-white/10 py-3 text-sm font-semibold text-muted hover:text-white" @click="showAddForm = false">{{ t.common.cancel }}</button>
                <button type="submit" :disabled="adding" class="flex-[2] rounded-xl bg-accent py-3 text-sm font-bold text-on-accent disabled:opacity-60" data-testid="new-item-save">{{ t.bike.addItem }}</button>
              </div>
            </form>
          </section>
        </div>
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

      <PremixSheet
        v-if="data.bike.vehicleType !== 'car' && data.bike.stroke === '2T'"
        v-model:open="premixOpen"
        :bike-id="data.bike.id"
        :bike-name="data.bike.name"
        :initial-ratio="data.bike.premixRatio ?? 50"
        @saved="(r) => { if (data) data.bike.premixRatio = r }"
      />
      <ReminderSheet
        v-model:open="reminderOpen"
        :bikes="store.bikes.length ? store.bikes : [{ id: data.bike.id, name: data.bike.name, vehicleType: data.bike.vehicleType }]"
        :default-bike-id="data.bike.id"
        :initial-reminder="reminderToEdit"
        @saved="loadReminders"
      />
    </template>
    <div v-else-if="!error" class="mt-2" data-testid="bike-loading">
      <div class="h-9 w-2/3 bg-surface motion-safe:animate-pulse" aria-hidden="true" />
      <Skeleton :rows="1" height="h-24" class="mt-4" />
      <Skeleton :rows="4" height="h-16" class="mt-4" />
    </div>
  </main>
</template>
