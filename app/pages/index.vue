<script setup lang="ts">
const store = useBikesStore()
const { hours, km } = useFormatters()
const { syncTick } = useOffline()
const error = ref('')

async function load() {
  try {
    await store.fetchBikes()
    error.value = ''
  } catch {
    error.value = 'Could not load your bikes.'
  }
}
// The app always opens here: every bike with what's overdue or due soon.
onMounted(load)
watch(syncTick, load)
</script>

<template>
  <main class="mx-auto max-w-md p-4 pt-0">
    <div class="brand-band -mx-4 mb-4" aria-hidden="true" />
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-2.5">
        <span class="brand-mark" aria-hidden="true">ET</span>
        <span class="font-tag text-[11px] leading-tight tracking-[0.08em] text-muted">ENDURO TRACKER<br>MAINTENANCE · COSTS</span>
      </div>
      <NuxtLink to="/settings" class="-mr-2 flex size-11 items-center justify-center text-text" aria-label="Settings" data-testid="settings-link"><Icon name="settings" :size="22" /></NuxtLink>
    </div>
    <h1 class="mt-4 text-[46px] text-white">Garage</h1>
    <p v-if="error" role="alert" class="mt-3 text-danger-text">{{ error }}</p>

    <ul v-if="store.bikes.length" class="mt-4 space-y-3" data-testid="bike-list">
      <li v-for="b in store.bikes" :key="b.id">
        <NuxtLink :to="`/bikes/${b.id}`" class="bike-tag" :class="{ 'is-alert': b.counts.overdue }" data-testid="bike-card">
          <span class="bike-tag-stripe" aria-hidden="true" />
          <div class="relative pr-6">
            <div class="brand-slant text-[23px] font-black uppercase leading-none" style="font-stretch: 110%">{{ b.name }}</div>
            <div class="bike-tag-sub mt-1.5 truncate font-tag text-xs uppercase">{{ [b.make, b.model].filter(Boolean).join(' · ') }} · {{ b.year }}</div>
            <div class="mt-3 flex flex-wrap gap-1.5 font-tag text-xs font-semibold">
              <span v-if="b.counts.overdue" class="bike-tag-badge px-[7px] py-1" data-testid="count-overdue">{{ b.counts.overdue }} OVERDUE</span>
              <span v-if="b.counts.soon" class="border-[1.5px] border-current px-1.5 py-[3px]" data-testid="count-soon">{{ b.counts.soon }} SOON</span>
              <span v-if="!b.counts.overdue && !b.counts.soon" class="bike-tag-sub border border-current px-1.5 py-[3px] font-normal">ALL OK</span>
            </div>
          </div>
          <div v-if="b.latestReading" class="bike-tag-rule relative mt-3.5 flex gap-6 pt-2.5 font-tag">
            <span v-if="countsHours(b.meters) && b.latestReading.hoursTenths !== null"><small class="bike-tag-sub block text-[10px] tracking-[0.12em]">HRS</small><b class="text-[22px] font-semibold">{{ hours(b.latestReading.hoursTenths).replace(/ h$/, '') }}</b></span>
            <span v-if="countsKm(b.meters) && b.latestReading.km !== null"><small class="bike-tag-sub block text-[10px] tracking-[0.12em]">KM</small><b class="text-[22px] font-semibold">{{ km(b.latestReading.km).replace(/ km$/, '') }}</b></span>
          </div>
        </NuxtLink>
      </li>
    </ul>
    <p v-else-if="store.loaded && !store.pendingBikes.length" class="mt-3 text-muted" data-testid="empty-garage">No bikes yet.</p>
    <ul v-if="store.pendingBikes.length" class="mt-3 space-y-3">
      <li v-for="b in store.pendingBikes" :key="b.id" class="rounded-xl bg-surface p-4 opacity-70" data-testid="bike-card-pending">
        <div class="truncate text-lg font-bold text-white">{{ b.name }}</div>
        <div class="text-xs text-warn-text">Waiting to sync — opens once you're back online</div>
      </li>
    </ul>

    <NuxtLink to="/shelf" class="mt-3 flex min-h-14 items-center justify-between bg-surface px-4 py-3" data-testid="garage-shelf">
      <span class="brand-slant flex items-center gap-2.5 font-extrabold uppercase text-white" style="font-stretch: 110%"><Icon name="shelf" />Shelf</span>
      <span class="font-tag text-xs text-muted">PARTS · TO BUY →</span>
    </NuxtLink>

    <NuxtLink
      to="/bikes/new"
      class="brand-slant mt-3 block bg-accent py-3.5 text-center font-black uppercase tracking-[0.04em] text-on-accent" style="font-stretch: 125%"
      data-testid="add-bike"
    >
      + Add bike
    </NuxtLink>
  </main>
</template>
