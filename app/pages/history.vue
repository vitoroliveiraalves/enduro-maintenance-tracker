<script setup lang="ts">
import { errorMessage } from '~/offline/outbox'
import { partsLine, type PartUsedLine } from '~/lib/parts-used'

type Bike = { id: string; name: string }
type Svc = {
  id: string; bikeId: string; bikeName: string; at: string; atUnknown?: boolean; notes: string | null; hoursTenths: number | null; km: number | null
  by: 'diy' | 'garage'; garageName: string | null; documentId: string | null; itemNames: string[]; totalCents: number
  partsUsed?: PartUsedLine[]
  pending?: boolean
}
type Exp = {
  id: string; bikeId: string | null; at: string; amountCents: number; categoryName: string
  description: string; documentId: string | null; serviceId: string | null
  pending?: boolean
}
type Entry = { kind: 'service'; key: string; at: string; s: Svc } | { kind: 'expense'; key: string; at: string; e: Exp }

const { get, mutate } = useApi()
const { money, hours, date } = useFormatters()
const store = useBikesStore()
const { syncTick } = useOffline()

const bikeFilter = ref('')
const services = ref<Svc[]>([])
const expenses = ref<Exp[]>([])
const loaded = ref(false)
const error = ref('')
const expenseOpen = ref(false)
const confirmId = ref<string | null>(null)

const bikes = computed<Bike[]>(() => store.bikes)

async function load() {
  error.value = ''
  const q = bikeFilter.value ? `?bikeId=${bikeFilter.value}` : ''
  try {
    ;[services.value, expenses.value] = await Promise.all([get<Svc[]>(`/api/services${q}`), get<Exp[]>(`/api/expenses${q}`)])
    loaded.value = true
  } catch (e) {
    error.value = errorMessage(e, 'Could not load history.', true)
  }
}

onMounted(async () => {
  if (!store.loaded) await store.fetchBikes().catch(() => {})
  await load()
})
watch(bikeFilter, load)
watch(syncTick, load)

const timeline = computed<Entry[]>(() => {
  const list: Entry[] = [
    ...services.value.map((s): Entry => ({ kind: 'service', key: `s${s.id}`, at: s.at, s })),
    ...expenses.value.filter((e) => !e.serviceId).map((e): Entry => ({ kind: 'expense', key: `e${e.id}`, at: e.at, e })),
  ]
  // stable: API order (newest first) is kept within the same day
  return list.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
})

async function removeService(id: string) {
  try {
    await mutate(`/api/services/${id}`, {}, { method: 'DELETE' })
    confirmId.value = null
    await load()
  } catch (e) {
    error.value = errorMessage(e, 'Could not delete the service.', true)
  }
}
async function removeExpense(id: string) {
  try {
    await mutate(`/api/expenses/${id}`, {}, { method: 'DELETE' })
    confirmId.value = null
    await load()
  } catch (e) {
    error.value = errorMessage(e, 'Could not delete the expense.', true)
  }
}
</script>

<template>
  <main class="mx-auto max-w-md p-4 pb-24">
    <div class="flex items-center justify-between gap-2">
      <h1 class="text-xl font-bold text-white">History</h1>
      <button type="button" class="rounded-full bg-accent px-4 py-2 text-sm font-bold text-on-accent" data-testid="add-expense" @click="expenseOpen = true">+ Expense</button>
    </div>
    <label v-if="bikes.length > 1" class="mt-3 block text-[11px] uppercase tracking-wider text-muted">
      Bike
      <select v-model="bikeFilter" data-testid="bike-filter" class="mt-1 block w-full rounded-xl bg-surface px-3 py-2.5 text-base normal-case text-white">
        <option value="">All bikes</option>
        <option v-for="b in bikes" :key="b.id" :value="b.id">{{ b.name }}</option>
      </select>
    </label>
    <p v-if="error" role="alert" class="mt-3 text-danger">{{ error }}</p>
    <p v-else-if="loaded && !timeline.length" class="mt-4 text-muted" data-testid="history-empty">Nothing logged yet. Mark an item done or add an expense.</p>

    <ul class="mt-3 space-y-2">
      <li v-for="en in timeline" :key="en.key" class="rounded-xl bg-surface px-3 py-2.5 text-sm" :data-testid="en.kind === 'service' ? 'history-service' : 'history-expense'">
        <template v-if="en.kind === 'service'">
          <div class="flex items-baseline justify-between gap-2">
            <span class="font-semibold text-white">{{ en.s.itemNames.join(', ') || 'Service' }}</span>
            <span v-if="en.s.totalCents" class="shrink-0 font-bold text-white" data-testid="history-amount">{{ money(en.s.totalCents) }}</span>
          </div>
          <p class="mt-0.5 text-xs text-muted">
            {{ en.s.atUnknown ? 'Date unknown' : date(en.s.at) }}<template v-if="en.s.hoursTenths !== null"> · {{ hours(en.s.hoursTenths) }}</template>
            · {{ en.s.bikeName }} · {{ en.s.by === 'garage' ? (en.s.garageName ? `Garage: ${en.s.garageName}` : 'Garage') : 'DIY' }}
            <span v-if="en.s.notes === 'Initial'"> · from setup</span>
            <span v-if="en.s.documentId"> · <NuxtLink :to="`/invoice/${en.s.documentId}`" class="-m-2 inline-flex p-2 align-middle text-text" aria-label="Open invoice" data-testid="history-invoice"><Icon name="invoice" :size="15" /></NuxtLink></span>
          </p>
          <p v-if="en.s.partsUsed?.length" class="mt-0.5 text-xs text-muted" data-testid="history-parts">{{ partsLine(en.s.partsUsed) }}</p>
          <p v-if="en.s.pending" class="mt-1.5 text-xs text-warn-text" data-testid="history-pending">Pending sync</p>
          <div v-else class="mt-1.5 text-xs">
            <template v-if="confirmId === en.key">
              <span class="text-warn">Delete this service?</span>
              <button type="button" class="ml-2 font-bold text-danger" data-testid="confirm-delete" @click="removeService(en.s.id)">Yes, delete</button>
              <button type="button" class="ml-3 text-muted" @click="confirmId = null">Keep</button>
            </template>
            <button v-else type="button" class="-my-2 min-h-11 px-2 text-muted" data-testid="delete-service" @click="confirmId = en.key">Delete</button>
          </div>
        </template>
        <template v-else>
          <div class="flex items-baseline justify-between gap-2">
            <span class="font-semibold text-white">{{ en.e.categoryName }}<span v-if="en.e.description" class="font-normal text-muted"> · {{ en.e.description }}</span></span>
            <span class="shrink-0 font-bold text-white" data-testid="history-amount">{{ money(en.e.amountCents) }}</span>
          </div>
          <p class="mt-0.5 text-xs text-muted">
            {{ date(en.e.at) }}<span v-if="en.e.documentId"> · <NuxtLink :to="`/invoice/${en.e.documentId}`" class="-m-2 inline-flex p-2 align-middle text-text" aria-label="Open invoice" data-testid="history-expense-invoice"><Icon name="invoice" :size="15" /></NuxtLink></span>
          </p>
          <p v-if="en.e.pending" class="mt-1.5 text-xs text-warn-text" data-testid="history-pending">Pending sync</p>
          <div v-else class="mt-1.5 text-xs">
            <template v-if="confirmId === en.key">
              <span class="text-warn">Delete this expense?</span>
              <button type="button" class="ml-2 font-bold text-danger" data-testid="confirm-delete" @click="removeExpense(en.e.id)">Yes, delete</button>
              <button type="button" class="ml-3 text-muted" @click="confirmId = null">Keep</button>
            </template>
            <button v-else type="button" class="-my-2 min-h-11 px-2 text-muted" data-testid="delete-expense" @click="confirmId = en.key">Delete</button>
          </div>
        </template>
      </li>
    </ul>
    <ExpenseSheet v-model:open="expenseOpen" :bikes="bikes" :default-bike-id="bikeFilter || null" @saved="load" />
  </main>
</template>
