<script setup lang="ts">
import { OfflineError } from '~/offline/outbox'

type Period = 'month' | 'year' | 'all'
type Costs = {
  totalCents: number
  compare: { previousToDateCents: number; pct: number | null } | null
  perHourCents: number | null
  perKmCents: number | null
  hoursTenths: number
  km: number
  byMonth?: Array<{ month: number; cents: number }>
  byCategory: Array<{ categoryId: string; name: string; cents: number }>
  byBike: Array<{ bikeId: string | null; name: string; cents: number; hoursTenths: number; km: number }>
  expenses?: Array<{ id: string; at: string; bikeName: string | null; categoryName: string; description: string; amountCents: number; documentId: string | null }>
  upcoming?: Array<{ itemId: string; name: string; state: 'overdue' | 'soon'; estimateCents: number | null }>
}

const route = useRoute()
const router = useRouter()
const { get } = useApi()
const { money, hours, km, dayMonth } = useFormatters()
const store = useBikesStore()
const { syncTick } = useOffline()

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
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
      error.value = "You're offline — this period isn't saved on this phone yet."
    } else error.value = 'Could not load costs.'
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
  if (period.value === 'all') return 'All time'
  if (period.value === 'year') return isCurrentYear.value ? `${year.value} so far` : String(year.value)
  return MONTHS[month.value - 1]!
})
const navLabel = computed(() => (period.value === 'year' ? String(year.value) : `${MONTHS[month.value - 1]!.slice(0, 3)} ${year.value}`))
const rideLine = computed(() => {
  const d = data.value
  if (!d) return ''
  const parts = [d.hoursTenths ? `${hours(d.hoursTenths)} ridden` : '', d.perHourCents !== null ? `${money(d.perHourCents)}/h` : '']
  return parts.filter(Boolean).join(' · ')
})
const compareLine = computed(() => {
  const c = data.value?.compare
  if (!c) return null
  const when = isCurrentYear.value ? 'at this point' : 'overall'
  if (c.pct === null) return { text: `Nothing spent in ${year.value - 1} ${when}`, cls: 'text-muted' }
  if (c.pct === 0) return { text: `Same as ${year.value - 1} ${when}`, cls: 'text-muted' }
  return { text: `${c.pct > 0 ? '▲' : '▼'} ${Math.abs(c.pct)}% vs ${year.value - 1} ${when}`, cls: c.pct > 0 ? 'text-warn-text' : 'text-ok-text' }
})
const showBikes = computed(() => !bikeId.value && (data.value?.byBike.length ?? 0) > 0)
const SEG: Array<{ key: Period; label: string }> = [
  { key: 'month', label: 'Month' },
  { key: 'year', label: 'Year' },
  { key: 'all', label: 'All time' },
]
</script>

<template>
  <main class="mx-auto max-w-md p-4 pb-24">
    <div class="flex items-center justify-between gap-2 text-[13px]">
      <label class="sr-only" for="costs-bike">Bike</label>
      <select
        id="costs-bike"
        :value="bikeId"
        data-testid="costs-bike"
        class="min-w-0 max-w-[55%] truncate rounded-lg bg-surface px-2.5 py-2 text-[13px] text-white"
        @change="go({ bikeId: ($event.target as HTMLSelectElement).value || undefined })"
      >
        <option value="">All bikes</option>
        <option v-for="b in store.bikes" :key="b.id" :value="b.id">{{ b.name }}</option>
      </select>
      <a :href="exportHref" download data-testid="export-csv" class="shrink-0 rounded-lg px-2.5 py-2 text-muted">⤓ Export CSV</a>
    </div>

    <h1 class="mb-2.5 mt-2 text-xl font-bold text-white">Running costs</h1>

    <div role="group" aria-label="Period" class="mb-3 flex rounded-[10px] bg-surface p-[3px]">
      <button
        v-for="s in SEG"
        :key="s.key"
        type="button"
        :aria-pressed="period === s.key"
        :data-testid="`seg-${s.key}`"
        class="flex-1 rounded-lg py-1.5 text-xs"
        :class="period === s.key ? 'bg-track font-bold text-white' : 'text-muted'"
        @click="go({ period: s.key === 'month' ? undefined : s.key })"
      >
        {{ s.label }}
      </button>
    </div>

    <div v-if="period !== 'all'" class="mb-3 flex items-center justify-between text-sm">
      <button type="button" aria-label="Previous" data-testid="period-prev" class="h-9 w-12 rounded-lg bg-surface text-lg text-white" @click="shift(-1)">‹</button>
      <span data-testid="period-label" class="font-semibold text-white">{{ navLabel }}</span>
      <button type="button" aria-label="Next" data-testid="period-next" class="h-9 w-12 rounded-lg bg-surface text-lg text-white" @click="shift(1)">›</button>
    </div>

    <p v-if="error" role="alert" class="text-danger">{{ error }}</p>
    <template v-if="data">
      <section class="mb-2.5 rounded-[14px] bg-surface p-3">
        <div class="text-[11px] uppercase tracking-wider text-muted">{{ label }}</div>
        <div class="text-[28px] font-extrabold text-white" data-testid="costs-total">{{ money(data.totalCents) }}</div>
        <div v-if="compareLine" class="text-xs" :class="compareLine.cls" data-testid="costs-compare">{{ compareLine.text }}</div>
        <div v-else-if="rideLine" class="text-xs text-muted">{{ rideLine }}</div>
      </section>

      <div class="mb-2.5 flex gap-2" data-testid="costs-kpis">
        <div class="flex-1 rounded-xl bg-surface px-2.5 py-2">
          <span class="text-[10px] uppercase tracking-wide text-muted">Per hour</span>
          <b class="block text-[17px] text-white" data-testid="kpi-hour">{{ data.perHourCents === null ? '—' : money(data.perHourCents) }}</b>
        </div>
        <div class="flex-1 rounded-xl bg-surface px-2.5 py-2">
          <span class="text-[10px] uppercase tracking-wide text-muted">Per km</span>
          <b class="block text-[17px] text-white" data-testid="kpi-km">{{ data.perKmCents === null ? '—' : money(data.perKmCents) }}</b>
        </div>
        <div class="flex-1 rounded-xl bg-surface px-2.5 py-2">
          <span class="text-[10px] uppercase tracking-wide text-muted">Hours</span>
          <b class="block text-[17px] text-white" data-testid="kpi-hours">{{ hours(data.hoursTenths) }}</b>
        </div>
      </div>

      <template v-if="data.byMonth">
        <h2 class="mb-1.5 mt-3 text-[11px] uppercase tracking-widest text-muted">By month</h2>
        <BarChart :months="data.byMonth" :current-month="isCurrentYear ? Number(today.slice(5, 7)) : 0" :future-after="isCurrentYear ? Number(today.slice(5, 7)) : year > Number(today.slice(0, 4)) ? 0 : 12" />
        <div class="h-3" />
      </template>

      <template v-if="data.expenses">
        <h2 class="mb-1.5 mt-3 text-[11px] uppercase tracking-widest text-muted">Spent this month</h2>
        <p v-if="!data.expenses.length" class="text-sm text-muted" data-testid="costs-empty">Nothing spent in {{ label }}.</p>
        <ul class="space-y-[7px]">
          <li v-for="e in data.expenses" :key="e.id" class="flex justify-between gap-2 rounded-xl bg-surface px-3 py-2.5 text-[13px]" data-testid="costs-expense">
            <span class="min-w-0">
              <span class="block truncate text-text">{{ e.description || e.categoryName }}</span>
              <small class="block text-[11px] text-muted">{{ dayMonth(e.at) }} · {{ e.categoryName }}<template v-if="e.bikeName && !bikeId"> · {{ e.bikeName }}</template><template v-if="e.documentId"> · 🧾</template></small>
            </span>
            <b class="shrink-0 text-white">{{ money(e.amountCents) }}</b>
          </li>
        </ul>
      </template>

      <template v-if="data.upcoming && data.upcoming.length">
        <h2 class="mb-1.5 mt-4 text-[11px] uppercase tracking-widest text-muted">Coming up · estimated</h2>
        <ul class="space-y-1.5" data-testid="costs-upcoming">
          <li v-for="u in data.upcoming" :key="u.itemId" class="flex justify-between text-[13px]" data-testid="upcoming-row">
            <span>{{ u.name }} <small class="text-muted">· {{ u.state === 'overdue' ? 'due now' : 'soon' }}</small></span>
            <span class="text-text">{{ u.estimateCents === null ? '—' : `~${money(u.estimateCents)}` }}</span>
          </li>
        </ul>
        <p class="mt-1.5 text-xs text-muted">Estimates use the last price you paid.</p>
      </template>

      <template v-if="data.byCategory.length">
        <h2 class="mb-2 mt-4 text-[11px] uppercase tracking-widest text-muted">Where it went</h2>
        <CategoryBars :rows="data.byCategory" />
      </template>

      <template v-if="showBikes">
        <h2 class="mb-1.5 mt-4 text-[11px] uppercase tracking-widest text-muted">By bike</h2>
        <ul class="space-y-[7px]">
          <li v-for="b in data.byBike" :key="b.bikeId ?? 'none'" class="flex justify-between gap-2 rounded-xl bg-surface px-3 py-2.5 text-[13px]" data-testid="costs-bike-row">
            <span class="min-w-0">
              <span class="block truncate text-text">{{ b.name }}</span>
              <small v-if="b.bikeId" class="block text-[11px] text-muted">{{ hours(b.hoursTenths) }} · {{ km(b.km) }}</small>
            </span>
            <span class="shrink-0 text-right">
              <b class="block text-white">{{ money(b.cents) }}</b>
              <small v-if="b.hoursTenths > 0" class="block text-[11px] text-muted">{{ money(Math.round(b.cents / (b.hoursTenths / 10))) }}/h</small>
            </span>
          </li>
        </ul>
      </template>
    </template>
  </main>
</template>
