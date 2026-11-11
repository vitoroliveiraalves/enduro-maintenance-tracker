<script setup lang="ts">
const { t } = useI18n()
const store = useBikesStore()
const { hours, km } = useFormatters()
const { syncTick } = useOffline()
const error = ref('')

async function load() {
  try {
    await store.fetchBikes()
    error.value = ''
  } catch {
    error.value = t.value.garage.loadFailed
  }
}
// The app always opens here: every bike with what's overdue or due soon.
onMounted(load)
watch(syncTick, load)

// Fleet KPI Telemetry
const fleetCount = computed(() => store.bikes.length)
const totalOverdue = computed(() => store.bikes.reduce((acc, b) => acc + (b.counts.overdue || 0), 0))
const totalSoon = computed(() => store.bikes.reduce((acc, b) => acc + (b.counts.soon || 0), 0))
const totalHoursTenths = computed(() =>
  store.bikes.reduce((acc, b) => acc + (b.latestReading?.hoursTenths || 0), 0),
)
const totalKmCount = computed(() =>
  store.bikes.reduce((acc, b) => acc + (b.latestReading?.km || 0), 0),
)
</script>

<template>
  <main class="mx-auto max-w-md lg:max-w-7xl w-full p-4 pt-0 lg:p-8 lg:pt-6">
    <!-- Mobile-only Brand Header -->
    <div class="brand-band -mx-4 mb-4 lg:hidden" aria-hidden="true" />
    <div class="flex items-center justify-between lg:hidden">
      <div class="flex items-center gap-2.5">
        <BrandMark />
        <span class="font-tag text-[11px] leading-tight tracking-[0.08em] text-muted">DIRT GARAGE<br>{{ t.garage.tagline }}</span>
      </div>
      <NuxtLink to="/settings" class="-mr-2 flex size-11 items-center justify-center text-text" :aria-label="t.garage.settings" data-testid="settings-link"><Icon name="settings" :size="22" /></NuxtLink>
    </div>

    <!-- Title & Desktop Action Header -->
    <div class="mt-4 lg:mt-0 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
      <div>
        <h1 class="text-[46px] lg:text-5xl text-white">{{ t.garage.title }}</h1>
        <p class="hidden lg:block text-sm text-muted font-tag mt-1">{{ t.garage.tagline }}</p>
      </div>
      <NuxtLink
        to="/bikes/new"
        class="hidden lg:inline-flex brand-slant items-center gap-2 bg-accent px-5 py-2.5 font-black uppercase text-xs tracking-wider text-on-accent transition hover:brightness-110 active:scale-95"
        data-testid="desktop-add-bike-btn"
      >
        <span>{{ t.garage.addBike }}</span>
      </NuxtLink>
    </div>

    <!-- Desktop KPI / Telemetry Bar -->
    <div
      v-if="store.loaded && store.bikes.length"
      class="hidden lg:grid lg:grid-cols-4 gap-4 mt-6 mb-6"
      data-testid="desktop-kpi-bar"
    >
      <!-- Card 1: Active Fleet -->
      <div class="border border-text/15 bg-surface/70 p-4 rounded flex flex-col justify-between">
        <div class="font-tag text-[11px] uppercase tracking-[0.14em] text-muted font-semibold">{{ t.garage.kpi.activeFleet }}</div>
        <div class="mt-2 flex items-baseline gap-2">
          <span class="text-3xl font-black font-tag text-text">{{ fleetCount }}</span>
          <span class="font-tag text-xs text-muted">{{ t.garage.kpi.vehicles(fleetCount) }}</span>
        </div>
      </div>

      <!-- Card 2: Overdue Maintenance -->
      <div
        class="border p-4 rounded flex flex-col justify-between transition"
        :class="totalOverdue > 0 ? 'border-danger/40 bg-danger/10 text-danger-text' : 'border-text/15 bg-surface/70 text-text'"
      >
        <div class="font-tag text-[11px] uppercase tracking-[0.14em] font-semibold" :class="totalOverdue > 0 ? 'text-danger-text' : 'text-muted'">{{ t.garage.kpi.overdueTasks }}</div>
        <div class="mt-2 flex items-baseline gap-2">
          <span class="text-3xl font-black font-tag" :class="totalOverdue > 0 ? 'text-danger-text' : 'text-text'">{{ totalOverdue }}</span>
          <span v-if="totalOverdue > 0" class="font-tag text-[11px] font-semibold px-2 py-0.5 rounded bg-danger/25 border border-danger/40 uppercase">{{ t.garage.kpi.actionNeeded }}</span>
          <span v-else class="font-tag text-[11px] text-ok-text font-semibold uppercase">{{ t.garage.kpi.allClear }}</span>
        </div>
      </div>

      <!-- Card 3: Due Soon -->
      <div
        class="border p-4 rounded flex flex-col justify-between transition"
        :class="totalSoon > 0 ? 'border-warn/40 bg-warn/10 text-warn-text' : 'border-text/15 bg-surface/70 text-text'"
      >
        <div class="font-tag text-[11px] uppercase tracking-[0.14em] font-semibold" :class="totalSoon > 0 ? 'text-warn-text' : 'text-muted'">{{ t.garage.kpi.dueSoonTasks }}</div>
        <div class="mt-2 flex items-baseline gap-2">
          <span class="text-3xl font-black font-tag" :class="totalSoon > 0 ? 'text-warn-text' : 'text-text'">{{ totalSoon }}</span>
          <span class="font-tag text-xs text-muted">{{ t.garage.kpi.upcoming }}</span>
        </div>
      </div>

      <!-- Card 4: Fleet Telemetry -->
      <div class="border border-text/15 bg-surface/70 p-4 rounded flex flex-col justify-between">
        <div class="font-tag text-[11px] uppercase tracking-[0.14em] text-muted font-semibold">{{ t.garage.kpi.telemetry }}</div>
        <div class="mt-2 flex items-baseline gap-4 font-tag">
          <div v-if="totalHoursTenths > 0">
            <span class="text-2xl font-black text-text">{{ hours(totalHoursTenths).replace(/ h$/, '') }}</span>
            <span class="text-[10px] text-muted ml-1 uppercase">{{ t.garage.hrs }}</span>
          </div>
          <div v-if="totalKmCount > 0">
            <span class="text-2xl font-black text-text">{{ km(totalKmCount).replace(/ km$/, '') }}</span>
            <span class="text-[10px] text-muted ml-1 uppercase">{{ t.garage.km }}</span>
          </div>
          <div v-if="totalHoursTenths === 0 && totalKmCount === 0" class="text-base text-muted font-tag">
            —
          </div>
        </div>
      </div>
    </div>

    <p v-if="error" role="alert" class="mt-3 text-danger-text">{{ error }}</p>

    <Skeleton v-if="!store.loaded && !error" :rows="2" height="h-28" class="mt-4" />
    <ul v-else-if="store.bikes.length" class="mt-4 space-y-3 lg:grid lg:grid-cols-2 xl:grid-cols-3 lg:gap-5 lg:space-y-0" data-testid="bike-list">
      <li v-for="b in store.bikes" :key="b.id">
        <NuxtLink :to="`/bikes/${b.id}`" class="bike-tag h-full flex flex-col justify-between transition hover:border-accent" :class="{ 'is-alert': b.counts.overdue }" data-testid="bike-card">
          <span class="bike-tag-stripe" aria-hidden="true" />
          <div class="relative pr-6">
            <div class="flex items-center justify-between gap-2">
              <div class="brand-slant text-[23px] font-black uppercase leading-none" style="font-stretch: 110%">{{ b.name }}</div>
              <span v-if="b.plate" class="rounded border border-text/40 bg-bg px-2 py-0.5 font-tag text-xs font-bold tracking-widest text-text shrink-0" data-testid="plate-badge">{{ b.plate }}</span>
            </div>
            <div class="bike-tag-sub mt-1.5 truncate font-tag text-xs uppercase flex items-center gap-1.5">
              <span>{{ b.vehicleType === 'car' ? '🚗' : '🏍️' }}</span>
              <span>{{ [b.make, b.model].filter(Boolean).join(' · ') }} · {{ b.year }}</span>
            </div>
            <div class="mt-3 flex flex-wrap gap-1.5 font-tag text-xs font-semibold">
              <span v-if="b.counts.overdue" class="bike-tag-badge px-[7px] py-1" data-testid="count-overdue">{{ t.garage.overdue(b.counts.overdue) }}</span>
              <span v-if="b.counts.soon" class="border-[1.5px] border-current px-1.5 py-[3px]" data-testid="count-soon">{{ t.garage.soon(b.counts.soon) }}</span>
              <span v-if="!b.counts.overdue && !b.counts.soon" class="bike-tag-sub border border-current px-1.5 py-[3px] font-normal">{{ t.garage.allOk }}</span>
            </div>
          </div>
          <div v-if="b.latestReading" class="bike-tag-rule relative mt-3.5 flex items-center justify-between pt-2.5 font-tag">
            <div class="flex gap-6">
              <span v-if="countsHours(b.meters) && b.latestReading.hoursTenths !== null"><small class="bike-tag-sub block text-[10px] tracking-[0.12em]">{{ t.garage.hrs }}</small><b class="text-[22px] font-semibold">{{ hours(b.latestReading.hoursTenths).replace(/ h$/, '') }}</b></span>
              <span v-if="countsKm(b.meters) && b.latestReading.km !== null"><small class="bike-tag-sub block text-[10px] tracking-[0.12em]">{{ t.garage.km }}</small><b class="text-[22px] font-semibold">{{ km(b.latestReading.km).replace(/ km$/, '') }}</b></span>
            </div>
            <span class="hidden lg:inline-flex items-center gap-1 font-tag text-xs font-bold uppercase tracking-wider text-muted hover:text-text transition">
              Station →
            </span>
          </div>
        </NuxtLink>
      </li>
    </ul>
    <p v-else-if="store.loaded && !store.pendingBikes.length" class="mt-3 text-muted" data-testid="empty-garage">{{ t.garage.empty }}</p>
    <ul v-if="store.pendingBikes.length" class="mt-3 space-y-3 lg:grid lg:grid-cols-2 xl:grid-cols-3 lg:gap-5 lg:space-y-0">
      <li v-for="b in store.pendingBikes" :key="b.id" class="rounded-xl bg-surface p-4 opacity-70" data-testid="bike-card-pending">
        <div class="truncate text-lg font-bold text-white">{{ b.name }}</div>
        <div class="text-xs text-warn-text">{{ t.garage.pendingBike }}</div>
      </li>
    </ul>

    <!-- Bottom Actions / Links -->
    <div class="mt-6 flex flex-col sm:flex-row gap-4">
      <NuxtLink to="/shelf" class="flex-1 flex min-h-14 items-center justify-between bg-surface px-4 py-3 border border-text/10 hover:border-accent transition rounded" data-testid="garage-shelf">
        <span class="brand-slant flex items-center gap-2.5 font-extrabold uppercase text-white" style="font-stretch: 110%"><Icon name="shelf" />{{ t.garage.shelf }}</span>
        <span class="font-tag text-xs text-muted">{{ t.garage.shelfHint }}</span>
      </NuxtLink>

      <NuxtLink
        to="/bikes/new"
        class="brand-slant block bg-accent px-6 py-3.5 text-center font-black uppercase tracking-[0.04em] text-on-accent transition hover:brightness-110 active:scale-95" style="font-stretch: 125%"
        data-testid="add-bike"
      >
        {{ t.garage.addBike }}
      </NuxtLink>
    </div>
  </main>
</template>
