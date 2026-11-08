<script setup lang="ts">
import { stateText } from '~/lib/item-state'
import type { ItemRowJson } from '../../../../server/domain/item-row'

type Detail = {
  bike: { id: string; name: string; year: number }
  latestReading: { hoursTenths: number; km: number } | null
  items: ItemRowJson[]
}

const route = useRoute()
const id = route.params.id as string
const { get } = useApi()
const { hours, km } = useFormatters()
const store = useBikesStore()
const data = ref<Detail | null>(null)
const error = ref('')

onMounted(async () => {
  try {
    data.value = await get<Detail>(`/api/bikes/${id}`)
    store.setLast(id)
  } catch {
    error.value = 'Bike not found.'
  }
})

const tone = (s: string) => (s === 'overdue' ? 'text-danger' : s === 'soon' ? 'text-warn' : s === 'ok' ? 'text-ok' : 'text-muted')
</script>

<template>
  <main class="mx-auto max-w-md p-4">
    <NuxtLink to="/" class="text-sm text-muted">‹ Garage</NuxtLink>
    <p v-if="error" role="alert" class="mt-3 text-danger">{{ error }}</p>
    <template v-if="data">
      <h1 class="mt-2 text-xl font-bold text-white" data-testid="bike-name">{{ data.bike.name }}</h1>
      <div v-if="data.latestReading" class="mt-3 flex gap-2.5">
        <div class="flex-1 rounded-xl bg-surface px-3 py-2.5">
          <span class="text-[11px] uppercase tracking-wider text-muted">Hours</span>
          <b class="block text-2xl text-white">{{ hours(data.latestReading.hoursTenths) }}</b>
        </div>
        <div class="flex-1 rounded-xl bg-surface px-3 py-2.5">
          <span class="text-[11px] uppercase tracking-wider text-muted">Km</span>
          <b class="block text-2xl text-white">{{ km(data.latestReading.km) }}</b>
        </div>
      </div>
      <h2 class="mb-1.5 mt-4 text-[11px] uppercase tracking-widest text-muted">Maintenance · due soonest first</h2>
      <ul class="space-y-2">
        <li v-for="it in data.items" :key="it.id" class="flex justify-between rounded-xl bg-surface px-3 py-2.5 text-sm" data-testid="item-row">
          <span class="font-semibold text-white">{{ it.name }}</span>
          <span :class="tone(it.status.state)" data-testid="item-state">{{ stateText(it) }}</span>
        </li>
      </ul>
    </template>
  </main>
</template>
