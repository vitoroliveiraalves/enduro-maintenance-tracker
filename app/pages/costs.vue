<script setup lang="ts">
import { OfflineError } from '~/offline/outbox'
import { categoryLabel } from '~/lib/server-text'
const { t } = useI18n()

type Period = 'month' | 'year' | 'all'
type Costs = {
  totalCents: number
  compare: { previousToDateCents: number; pct: number | null } | null
  perHourCents: number | null
  perKmCents: number | null
  hoursTenths: number
  km: number
  countsHours?: boolean
  countsKm?: boolean
  byMonth?: Array<{ month: number; cents: number }>
  byCategory: Array<{ categoryId: string; name: string; cents: number }>
  byBike: Array<{ bikeId: string | null; name: string; meters?: BikeMeters; cents: number; hoursTenths: number; km: number }>
  expenses?: Array<{ id: string; at: string; bikeName: string | null; categoryName: string; description: string; amountCents: number; documentId: string | null }>
  upcoming?: Array<{ itemId: string; name: string; state: 'overdue' | 'soon'; estimateCents: number | null }>
}

const route = useRoute()
const router = useRouter()
const { get } = useApi()
const { money, hours, km, dayMonth } = useFormatters()
const store = useBikesStore()
const { syncTick } = useOffline()

const MONTHS = computed(() => t.value.chart.months)
const today = new Date().toISOString().slice(0, 10)
const str = (v: unknown) => (typeof v === 'string' ? v : '')

const period = computed<Period>(() => {
  const p = str(route.query.period)
  return p === 'year' || p === 'all' ? p : 'month'
})
const date = computed(() => (/^\d{4}-\d{2}-\d{2}$/.test(str(route.query.date)) ? str(route.query.date) : today))
const bikeId = computed(() => str(route.query.bikeId))
const year = computed(() => Number(date.value.slice(0, 4)))
const month = computed(() => Number(date.value.slice(5, 7)))

function go(patch: Record<string, string | undefined>) {
  const merged: Record<string, string | undefined> = { ...(route.query as Record<string, string>), ...patch }
  const q = Object.fromEntries(Object.entries(merged).filter(([, v]) => v)) as Record<string, string>
  return router.replace({ query: q })
}
const pad = (n: number) => String(n).padStart(2, '0')
// Taps can arrive before the router has applied the previous one, so step from the last requested date.
let requested = ''
function shift(dir: -1 | 1) {
  const base = requested || date.value
  const y = Number(base.slice(0, 4))
  const m = Number(base.slice(5, 7))
  const d = period.value === 'year' ? new Date(Date.UTC(y + dir, m - 1, 1)) : new Date(Date.UTC(y, m - 1 + dir, 1))
  requested = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-01`
  return go({ date: requested })
}
watch(date, (v) => {
  if (v === requested) requested = ''
})
const exportHref = computed(() => {
  const q = new URLSearchParams({ period: period.value, date: date.value })
  if (bikeId.value) q.set('bikeId', bikeId.value)
  return `/api/costs/export.csv?${q}`
})

const data = ref<Costs | null>(null)
const error = ref('')
const expenseOpen = ref(false)
const selectedCategory = ref<string | null>(null)

function toggleCategory(name: string) {
  selectedCategory.value = selectedCategory.value === name ? null : name
}

const shownExpenses = computed(() => {
  const list = data.value?.expenses ?? []
  if (!selectedCategory.value) return list
  return list.filter((e) => e.categoryName === selectedCategory.value)
})
let seq = 0
async function load() {
  const mine = ++seq
  const q = new URLSearchParams({ period: period.value, date: date.value })
  if (bikeId.value) q.set('bikeId', bikeId.value)
  try {
    const r = await get<Costs>(`/api/costs?${q}`)
    if (mine !== seq) return
    data.value = r
    error.value = ''
  } catch (e) {
    if (mine !== seq) return
    if (e instanceof OfflineError) {
      // Offline and this period was never opened here: don't leave the previous period on screen.
      data.value = null
      error.value = t.value.costs.offlinePeriod
    } else error.value = t.value.costs.loadFailed
  }
}
watch(() => [period.value, date.value, bikeId.value], load)
watch(syncTick, load)
onMounted(async () => {
  if (!store.loaded) await store.fetchBikes().catch(() => {})
  await load()
})

const isCurrentYear = computed(() => year.value === Number(today.slice(0, 4)))
const label = computed(() => {
  if (period.value === 'all') return t.value.costs.allTime
  if (period.value === 'year') return isCurrentYear.value ? t.value.costs.soFar(year.value) : String(year.value)
  return MONTHS.value[month.value - 1]!
})
const navLabel = computed(() => (period.value === 'year' ? String(year.value) : `${MONTHS.value[month.value - 1]!.slice(0, 3)} ${year.value}`))
const rideLine = computed(() => {
  const d = data.value
  if (!d) return ''
  // Hours when any bike in view counts them; otherwise (street bikes only) km.
  const parts = d.countsHours !== false
    ? [d.hoursTenths ? t.value.costs.ridden(hours(d.hoursTenths)) : '', d.perHourCents !== null ? `${money(d.perHourCents)}/h` : '']
    : [d.km ? t.value.costs.ridden(km(d.km)) : '', d.perKmCents !== null ? `${money(d.perKmCents)}/km` : '']
  return parts.filter(Boolean).join(' · ')
})
const compareLine = computed(() => {
  const c = data.value?.compare
  if (!c) return null
  const now = isCurrentYear.value
  const prev = year.value - 1
  if (c.pct === null) return { text: t.value.costs.nothingIn(prev, now), cls: 'text-muted' }
  if (c.pct === 0) return { text: t.value.costs.sameAs(prev, now), cls: 'text-muted' }
  return { text: t.value.costs.vs(c.pct > 0 ? '▲' : '▼', Math.abs(c.pct), prev, now), cls: c.pct > 0 ? 'text-warn-text' : 'text-ok-text' }
})
const showBikes = computed(() => !bikeId.value && (data.value?.byBike.length ?? 0) > 0)
const SEG = computed<Array<{ key: Period; label: string }>>(() => [
  { key: 'month', label: t.value.costs.month },
  { key: 'year', label: t.value.costs.year },
  { key: 'all', label: t.value.costs.allTime },
])
</script>

<template>
  <main class="mx-auto max-w-md lg:max-w-7xl p-4 pb-6 lg:p-8 lg:pb-12 w-full">
    <div class="flex items-center justify-between gap-2 border-b border-text/10 pb-3 mb-4">
      <div>
        <h1 class="text-xl lg:text-3xl font-bold text-white tracking-tight">{{ t.costs.title }}</h1>
        <p class="hidden lg:block text-xs font-tag text-muted mt-0.5">
          {{ navLabel }} · {{ label }}
        </p>
      </div>

      <div class="flex items-center gap-3">
        <label class="sr-only" for="costs-bike">{{ t.costs.bike }}</label>
        <select
          id="costs-bike"
          :value="bikeId"
          data-testid="costs-bike"
          class="min-w-0 max-w-[55%] lg:max-w-xs truncate rounded-lg bg-surface px-3 py-2 text-sm text-white border border-text/15"
          @change="go({ bikeId: ($event.target as HTMLSelectElement).value || undefined })"
        >
          <option value="">{{ t.common.allBikes }}</option>
          <option v-for="b in store.bikes" :key="b.id" :value="b.id">{{ b.name }}</option>
        </select>
        <a :href="exportHref" download data-testid="export-csv" class="shrink-0 rounded-lg border border-text/20 bg-surface px-3 py-2 text-xs font-bold text-text hover:border-accent uppercase font-tag">{{ t.costs.export }}</a>
        <button
          type="button"
          class="rounded-xl bg-accent px-3.5 py-2 text-xs font-bold text-on-accent hover:brightness-110 active:scale-95 transition"
          data-testid="costs-add-expense"
          @click="expenseOpen = true"
        >
          {{ t.costs.addExpense }}
        </button>
      </div>
    </div>

    <div role="group" :aria-label="t.costs.period" class="mb-3 flex rounded-[10px] bg-surface p-[3px] max-w-md">
      <button
        v-for="s in SEG"
        :key="s.key"
        type="button"
        :aria-pressed="period === s.key"
        :data-testid="`seg-${s.key}`"
        class="min-h-10 flex-1 rounded-lg py-2 text-xs font-tag uppercase tracking-wider transition"
        :class="period === s.key ? 'bg-track font-bold text-white' : 'text-muted hover:text-text'"
        @click="go({ period: s.key === 'month' ? undefined : s.key })"
      >
        {{ s.label }}
      </button>
    </div>

    <div v-if="period !== 'all'" class="mb-4 flex items-center justify-between text-sm max-w-md">
      <button type="button" :aria-label="t.costs.previous" data-testid="period-prev" class="h-10 w-12 rounded-lg bg-surface text-lg text-white hover:bg-surface/80" @click="shift(-1)">‹</button>
      <span data-testid="period-label" class="font-semibold text-white font-tag">{{ navLabel }}</span>
      <button type="button" :aria-label="t.costs.next" data-testid="period-next" class="h-10 w-12 rounded-lg bg-surface text-lg text-white hover:bg-surface/80" @click="shift(1)">›</button>
    </div>

    <p v-if="error" role="alert" class="text-danger-text">{{ error }}</p>
    <Skeleton v-else-if="!data" :rows="3" height="h-20" />
    <template v-if="data">
      <div class="lg:grid lg:grid-cols-12 lg:gap-8 lg:items-start">
        
        <!-- Left Column: Primary Telemetry & Monthly Trends (5 cols) -->
        <div class="lg:col-span-5 space-y-4">
          <section class="rounded-[14px] bg-surface p-4 border border-text/10">
            <div class="text-[11px] uppercase tracking-wider text-muted font-tag">{{ label }}</div>
            <div class="text-[32px] font-extrabold text-white font-tag mt-1" data-testid="costs-total">{{ money(data.totalCents) }}</div>
            <div v-if="compareLine" class="text-xs font-tag mt-1" :class="compareLine.cls" data-testid="costs-compare">{{ compareLine.text }}</div>
            <div v-else-if="rideLine" class="text-xs text-muted font-tag mt-1">{{ rideLine }}</div>
          </section>

          <div class="grid grid-cols-2 sm:grid-cols-3 gap-2" data-testid="costs-kpis">
            <div v-if="data.countsHours !== false" class="rounded-xl bg-surface px-3 py-2.5 border border-text/10">
              <span class="text-[10px] uppercase tracking-wide text-muted font-tag block">{{ t.costs.perHour }}</span>
              <b class="block text-[17px] text-white font-tag" data-testid="kpi-hour">{{ data.perHourCents === null ? '—' : money(data.perHourCents) }}</b>
            </div>
            <div v-if="data.countsKm !== false" class="rounded-xl bg-surface px-3 py-2.5 border border-text/10">
              <span class="text-[10px] uppercase tracking-wide text-muted font-tag block">{{ t.costs.perKm }}</span>
              <b class="block text-[17px] text-white font-tag" data-testid="kpi-km">{{ data.perKmCents === null ? '—' : money(data.perKmCents) }}</b>
            </div>
            <div v-if="data.countsHours !== false" class="rounded-xl bg-surface px-3 py-2.5 border border-text/10">
              <span class="text-[10px] uppercase tracking-wide text-muted font-tag block">{{ t.costs.hours }}</span>
              <b class="block text-[17px] text-white font-tag" data-testid="kpi-hours">{{ hours(data.hoursTenths) }}</b>
            </div>
            <div v-else class="rounded-xl bg-surface px-3 py-2.5 border border-text/10">
              <span class="text-[10px] uppercase tracking-wide text-muted font-tag block">{{ t.costs.km }}</span>
              <b class="block text-[17px] text-white font-tag" data-testid="kpi-km-total">{{ km(data.km) }}</b>
            </div>
          </div>

          <template v-if="data.byMonth">
            <div class="rounded-xl bg-surface p-4 border border-text/10">
              <h2 class="mb-3 text-[11px] uppercase tracking-widest text-muted font-tag">{{ t.costs.byMonth }}</h2>
              <BarChart :months="data.byMonth" :current-month="isCurrentYear ? Number(today.slice(5, 7)) : 0" :future-after="isCurrentYear ? Number(today.slice(5, 7)) : year > Number(today.slice(0, 4)) ? 0 : 12" />
            </div>
          </template>
        </div>

        <!-- Right Column: Category Breakdown, By Bike, & Expenses Ledger (7 cols) -->
        <div class="lg:col-span-7 space-y-4 mt-4 lg:mt-0">
          <template v-if="data.byCategory.length">
            <div class="rounded-xl bg-surface p-4 border border-text/10">
              <h2 class="mb-3 text-[11px] uppercase tracking-widest text-muted font-tag">{{ t.costs.whereItWent }}</h2>
              <CategoryBars :rows="data.byCategory" :selected-category="selectedCategory" @select="toggleCategory" />
            </div>
          </template>

          <template v-if="data.expenses">
            <div class="rounded-xl bg-surface p-4 border border-text/10">
              <div class="mb-3 flex items-center justify-between gap-2">
                <h2 class="text-[11px] uppercase tracking-widest text-muted font-tag">{{ period === 'month' ? t.costs.spentThisMonth : t.costs.spentInPeriod }}</h2>
                <button
                  v-if="selectedCategory"
                  type="button"
                  class="rounded-full bg-surface px-2.5 py-1 text-xs font-semibold text-accent-text"
                  data-testid="costs-clear-category"
                  @click="selectedCategory = null"
                >
                  {{ categoryLabel(selectedCategory) }} ×
                </button>
              </div>
              <p v-if="!shownExpenses.length" class="text-sm text-muted" data-testid="costs-empty">{{ t.costs.nothingSpent(label) }}</p>
              <ul class="space-y-[7px]">
                <li v-for="e in shownExpenses" :key="e.id" class="flex justify-between gap-2 rounded-xl bg-bg px-3 py-2.5 text-[13px] border border-text/5" data-testid="costs-expense">
                  <span class="min-w-0">
                    <span class="block truncate text-text font-semibold">{{ e.description || categoryLabel(e.categoryName) }}</span>
                    <small class="block text-[11px] text-muted font-tag">{{ dayMonth(e.at) }} · {{ categoryLabel(e.categoryName) }}<template v-if="e.bikeName && !bikeId"> · {{ e.bikeName }}</template><template v-if="e.documentId"> · <NuxtLink :to="`/invoice/${e.documentId}`" class="-m-2 inline-flex p-2 align-middle text-text" :aria-label="t.item.openInvoice" data-testid="costs-invoice"><Icon name="invoice" :size="15" /></NuxtLink></template></small>
                  </span>
                  <b class="shrink-0 text-white font-tag">{{ money(e.amountCents) }}</b>
                </li>
              </ul>
            </div>
          </template>

          <template v-if="data.upcoming && data.upcoming.length">
            <div class="rounded-xl bg-surface p-4 border border-text/10">
              <h2 class="mb-2 text-[11px] uppercase tracking-widest text-muted font-tag">{{ t.costs.comingUp }}</h2>
              <ul class="space-y-1.5" data-testid="costs-upcoming">
                <li v-for="u in data.upcoming" :key="u.itemId" class="flex justify-between text-[13px] py-1 border-b border-text/5 last:border-none" data-testid="upcoming-row">
                  <span>{{ u.name }} <small class="text-muted">· {{ u.state === 'overdue' ? t.costs.dueNow : t.costs.soon }}</small></span>
                  <span class="text-text font-tag">{{ u.estimateCents === null ? '—' : `~${money(u.estimateCents)}` }}</span>
                </li>
              </ul>
              <p class="mt-2 text-xs text-muted">{{ t.costs.estimates }}</p>
            </div>
          </template>

          <template v-if="showBikes">
            <div class="rounded-xl bg-surface p-4 border border-text/10">
              <h2 class="mb-3 text-[11px] uppercase tracking-widest text-muted font-tag">{{ t.costs.byBike }}</h2>
              <ul class="space-y-[7px]">
                <li
                  v-for="b in data.byBike"
                  :key="b.bikeId ?? 'none'"
                  :role="b.bikeId ? 'button' : undefined"
                  :tabindex="b.bikeId ? 0 : undefined"
                  class="flex justify-between gap-2 rounded-xl bg-bg px-3 py-2.5 text-[13px] border border-text/5"
                  :class="b.bikeId ? 'cursor-pointer transition hover:ring-1 hover:ring-accent' : ''"
                  data-testid="costs-bike-row"
                  @click="b.bikeId ? go({ bikeId: b.bikeId }) : undefined"
                  @keydown.enter.prevent="b.bikeId ? go({ bikeId: b.bikeId }) : undefined"
                  @keydown.space.prevent="b.bikeId ? go({ bikeId: b.bikeId }) : undefined"
                >
                  <span class="min-w-0">
                    <span class="block truncate text-text font-bold">{{ b.bikeId ? b.name : t.costs.noBike }}</span>
                    <small v-if="b.bikeId" class="block text-[11px] text-muted font-tag">{{ [countsHours(b.meters ?? 'hours_km') ? hours(b.hoursTenths) : '', countsKm(b.meters ?? 'hours_km') ? km(b.km) : ''].filter(Boolean).join(' · ') }}</small>
                  </span>
                  <span class="shrink-0 text-right">
                    <b class="block text-white font-tag">{{ money(b.cents) }}</b>
                    <small v-if="countsHours(b.meters ?? 'hours_km') && b.hoursTenths > 0" class="block text-[11px] text-muted font-tag">{{ money(Math.round(b.cents / (b.hoursTenths / 10))) }}/h</small>
                    <small v-else-if="!countsHours(b.meters ?? 'hours_km') && b.km > 0" class="block text-[11px] text-muted font-tag" data-testid="bike-per-km">{{ money(Math.round(b.cents / b.km)) }}/km</small>
                  </span>
                </li>
              </ul>
            </div>
          </template>
        </div>

      </div>
    </template>

    <ExpenseSheet v-model:open="expenseOpen" :bikes="store.bikes" :default-bike-id="bikeId || null" @saved="load" />
  </main>
</template>
