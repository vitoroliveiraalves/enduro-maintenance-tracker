<script setup lang="ts">
import { stateText, subline } from '~/lib/item-state'
import { parseDecimal } from '~/lib/parse-number'
import { partsLine, type PartUsedLine } from '~/lib/parts-used'
import { errorMessage, OfflineError } from '~/offline/outbox'
import type { ItemRowJson } from '../../../../../server/domain/item-row'

type Service = {
  id: string
  at: string
  atUnknown?: boolean
  hoursTenths: number | null
  km: number | null
  by: 'diy' | 'garage'
  garageName: string | null
  costCents: number
  documentId: string | null
  partsUsed?: PartUsedLine[]
  pending?: boolean
}
type History = { item: ItemRowJson & { bikeId: string }; status: ItemRowJson['status']; services: Service[]; pendingSync?: boolean; notCached?: boolean }
type Detail = {
  bike: { id: string; name: string; meters?: BikeMeters }
  latestReading: { at: string; hoursTenths: number | null; km: number | null } | null
  items: Array<ItemRowJson & { pendingSync?: boolean }>
}

const route = useRoute()
const bikeId = route.params.id as string
const itemId = route.params.itemId as string
const { get, mutate } = useApi()
const { money, hours, km, date } = useFormatters()

const hist = ref<History | null>(null)
const detail = ref<Detail | null>(null)
const error = ref('')
const doneOpen = ref(false)

const hText = ref('')
const kmText = ref('')
const bikeMeters = computed<BikeMeters>(() => detail.value?.bike.meters ?? 'hours_km')
const hasHours = computed(() => countsHours(bikeMeters.value))
const hasKm = computed(() => countsKm(bikeMeters.value))
const moText = ref('')
const editError = ref('')
const saved = ref(false)
const savedQueued = ref(false)
const saving = ref(false)
const { syncTick } = useOffline()

function fillEditor(item: ItemRowJson) {
  hText.value = item.def.everyHoursTenths ? String(item.def.everyHoursTenths / 10) : ''
  kmText.value = item.def.everyKm ? String(item.def.everyKm) : ''
  moText.value = item.def.everyMonths ? String(item.def.everyMonths) : ''
}

async function load() {
  const [h, d] = await Promise.all([
    get<History>(`/api/items/${itemId}/history`).catch((e) => e as unknown),
    get<Detail>(`/api/bikes/${bikeId}`).catch((e) => e as unknown),
  ])
  // A link with the item under another of the rider's bikes: go to the right one.
  if (!(h instanceof Error) && (h as History).item.bikeId !== bikeId) {
    return void (await navigateTo(`/bikes/${(h as History).item.bikeId}/items/${itemId}`, { replace: true }))
  }
  if (d instanceof Error) throw d
  detail.value = d as Detail
  if (!(h instanceof Error)) return void (hist.value = h as History)
  // Offline and this item was never opened here: the bike screen's copy of the
  // item still gives its status and lets the rider mark it done.
  const row = (d as Detail).items.find((i) => i.id === itemId)
  if (!(h instanceof OfflineError) || !row) throw h
  hist.value = { item: { ...row, bikeId }, status: row.status, services: [], pendingSync: row.pendingSync, notCached: true }
}

onMounted(async () => {
  try {
    await load()
    if (hist.value) fillEditor(hist.value.item)
  } catch (e) {
    error.value = errorMessage(e, 'Item not found.', true)
  }
})
watch(syncTick, async () => {
  await load().catch(() => {})
  if (hist.value && !saving.value) fillEditor(hist.value.item)
  savedQueued.value = false
})

async function renameItem(name: string) {
  await mutate(`/api/items/${itemId}`, { name }, { method: 'PATCH', queue: true })
  await load().catch(() => {})
  toast.show(`Renamed to ${name}`)
}
async function removeItem() {
  const name = hist.value?.item.name ?? 'Item'
  await mutate(`/api/items/${itemId}`, { archived: true }, { method: 'PATCH', queue: true })
  toast.show(`${name} removed`)
  await navigateTo(`/bikes/${bikeId}`)
}

const toast = useToast()
async function onDone(detail?: unknown) {
  const name = hist.value?.item.name
  if (name) toast.show(isQueued(detail) ? `${name} marked done on this phone · syncs when online` : `${name} marked done`)
  await load()
  fillEditor(hist.value!.item)
}

async function saveIntervals() {
  if (saving.value) return
  editError.value = ''
  saved.value = false
  const num = (t: string) => (t.trim() ? parseDecimal(t) : null)
  // Hidden (uncounted) units are not sent: the server keeps their stored interval.
  const [h, k, m] = [hasHours.value ? num(hText.value) : null, hasKm.value ? num(kmText.value) : null, num(moText.value)]
  const typed = [hasHours.value ? hText.value.trim() : '', hasKm.value ? kmText.value.trim() : '', moText.value.trim()]
  const parsed = [h, k, m]
  if (parsed.some((v, i) => (typed[i] && v === null) || (v !== null && v <= 0))) {
    return void (editError.value = 'Enter intervals as numbers above zero.')
  }
  if (h === null && k === null && m === null) return void (editError.value = 'Keep at least one interval.')
  saving.value = true
  try {
    const res = await mutate(
      `/api/items/${itemId}`,
      {
        ...(hasHours.value ? { everyHoursTenths: h === null ? null : Math.round(h * 10) } : {}),
        ...(hasKm.value ? { everyKm: k === null ? null : Math.round(k) } : {}),
        everyMonths: m === null ? null : Math.round(m),
      },
      { method: 'PATCH', queue: true },
    )
    savedQueued.value = isQueued(res)
    if (!savedQueued.value) {
      await load()
      fillEditor(hist.value!.item)
    }
    saved.value = true
  } catch (e) {
    editError.value = errorMessage(e, 'Could not save. Try again.')
  } finally {
    saving.value = false
  }
}

const tone = computed(() => {
  const s = hist.value?.status.state
  return s === 'overdue' ? 'text-danger-text' : s === 'soon' ? 'text-warn-text' : s === 'ok' ? 'text-ok-text' : 'text-muted'
})
const field = 'mt-1 block w-full rounded-xl bg-bg px-3 py-3 text-base normal-case text-white outline-none focus:ring-2 focus:ring-accent'
</script>

<template>
  <main class="mx-auto max-w-md px-4 pb-6 pt-[18px]">
    <div class="text-[13px] text-muted">
      <NuxtLink :to="`/bikes/${bikeId}`" class="-m-2 p-2" data-testid="back-to-bike">‹ {{ detail?.bike.name ?? 'Bike' }}</NuxtLink>
    </div>
    <p v-if="error" role="alert" class="mt-3 text-danger">{{ error }}</p>
    <template v-if="hist && detail">
      <h1 class="mb-3 mt-1.5 text-xl font-bold text-white" data-testid="item-name">{{ hist.item.name }}</h1>

      <section class="rounded-xl bg-surface px-3 py-3" data-testid="item-status">
        <div class="text-2xl font-bold" :class="tone" data-testid="item-state">{{ stateText(hist.item) }}</div>
        <div class="mt-0.5 text-xs text-muted">
          {{ subline(hist.item) }}<span v-if="hist.pendingSync" class="text-warn-text"> · done, pending sync</span>
        </div>
        <ProgressBar :state="hist.status.state" :ratio="hist.status.ratio" :label="`${hist.item.name} wear`" />
      </section>

      <button
        type="button"
        class="my-3.5 block w-full rounded-xl bg-accent p-[11px] text-sm font-bold text-on-accent"
        data-testid="mark-done"
        @click="doneOpen = true"
      >
        {{ hist.status.state === 'unknown' ? 'Set last done' : 'Mark done' }}
      </button>
      <MarkDoneSheet
        v-model:open="doneOpen"
        :bike-id="bikeId"
        :items="detail.items"
        :current="detail.latestReading"
        :meters="bikeMeters"
        :item-id="itemId"
        @saved="onDone"
      />

      <ItemNotes :item-id="itemId" :item-name="hist.item.name" />

      <h2 class="mb-1.5 mt-5 text-[11px] uppercase tracking-[0.08em] text-muted">Service interval</h2>
      <form class="rounded-xl bg-surface px-3 py-3" data-testid="interval-editor" @submit.prevent="saveIntervals" @input="editError = ''; saved = false">
        <div class="flex gap-2.5">
          <label v-if="hasHours" class="flex-1 text-[11px] uppercase tracking-wider text-muted">
            Hours
            <input v-model="hText" inputmode="decimal" autocomplete="off" data-testid="iv-hours" :class="field">
          </label>
          <label v-if="hasKm" class="flex-1 text-[11px] uppercase tracking-wider text-muted">
            Km
            <input v-model="kmText" inputmode="decimal" autocomplete="off" data-testid="iv-km" :class="field">
          </label>
          <label class="flex-1 text-[11px] uppercase tracking-wider text-muted">
            Months
            <input v-model="moText" inputmode="decimal" autocomplete="off" data-testid="iv-months" :class="field">
          </label>
        </div>
        <p v-if="editError" role="alert" class="mt-2 text-sm text-danger" data-testid="iv-error">{{ editError }}</p>
        <p v-else-if="saved" role="status" class="mt-2 text-sm text-ok-text" data-testid="iv-saved">{{ savedQueued ? 'Saved on this phone — syncs when you’re back online' : 'Saved' }}</p>
        <button type="submit" :disabled="saving" class="mt-3 w-full rounded-xl bg-bg py-3 text-sm font-semibold text-accent disabled:opacity-60" data-testid="iv-save">Save intervals</button>
      </form>

      <h2 class="mb-1.5 mt-4 text-[11px] uppercase tracking-[0.08em] text-muted">Service history</h2>
      <p v-if="hist.notCached" class="text-sm text-muted" data-testid="history-not-cached">The service history isn't saved on this phone yet — it shows once you're back online.</p>
      <p v-else-if="!hist.services.length" class="text-sm text-muted" data-testid="no-services">Not logged yet.</p>
      <ul v-else class="space-y-[7px]">
        <li v-for="s in hist.services" :key="s.id" class="rounded-xl bg-surface px-3 py-2.5" data-testid="service-entry">
          <div class="flex justify-between gap-2 text-sm font-semibold text-white">
            <span>{{ s.atUnknown ? 'Date unknown' : date(s.at) }}<span v-if="s.pending" class="ml-1.5 text-xs font-normal text-warn-text" data-testid="service-pending">pending sync</span></span>
            <span class="flex shrink-0 items-center gap-2">
              <span v-if="s.costCents" data-testid="service-cost">{{ money(s.costCents) }}</span>
              <NuxtLink v-if="s.documentId" :to="`/invoice/${s.documentId}`" class="-m-2 inline-flex p-2 align-middle text-text" aria-label="Open invoice" data-testid="service-invoice"><Icon name="invoice" :size="15" /></NuxtLink>
            </span>
          </div>
          <div class="mt-0.5 text-xs text-muted">
            {{ [s.hoursTenths !== null ? hours(s.hoursTenths) : null, s.km !== null ? km(s.km) : null, s.by === 'garage' ? (s.garageName ? `Garage · ${s.garageName}` : 'Garage') : 'DIY'].filter(Boolean).join(' · ') }}
          </div>
          <div v-if="s.partsUsed?.length" class="mt-0.5 text-xs text-muted" data-testid="service-parts">{{ partsLine(s.partsUsed) }}</div>
        </li>
      </ul>

      <h2 class="mb-1.5 mt-4 text-[11px] uppercase tracking-[0.08em] text-muted">Item</h2>
      <ManagePanel what="item" :name="hist.item.name" remove-note="Its service history and costs stay in History." :rename="renameItem" :remove="removeItem" />
    </template>
  </main>
</template>
