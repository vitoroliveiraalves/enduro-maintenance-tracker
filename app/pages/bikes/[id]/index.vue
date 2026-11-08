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
const sheetOpen = ref(false)
const doneOpen = ref(false)
const doneItemId = ref<string | null>(null)

function markDone(itemId: string) {
  doneItemId.value = itemId
  doneOpen.value = true
}

onMounted(async () => {
  try {
    data.value = await get<Detail>(`/api/bikes/${id}`)
    store.setLast(id)
  } catch {
    error.value = 'Bike not found.'
  }
})

function onSaved(detail: Record<string, unknown>) {
  data.value = detail as unknown as Detail
}

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
          <b class="block text-2xl text-white" data-testid="hours-value">{{ hours(data.latestReading.hoursTenths) }}</b>
        </div>
        <div class="flex-1 rounded-xl bg-surface px-3 py-2.5">
          <span class="text-[11px] uppercase tracking-wider text-muted">Km</span>
          <b class="block text-2xl text-white" data-testid="km-value">{{ km(data.latestReading.km) }}</b>
        </div>
      </div>
      <button
        type="button"
        class="mt-3 w-full rounded-xl bg-accent py-3.5 text-base font-bold text-black"
        data-testid="log-ride"
        @click="sheetOpen = true"
      >
        + Log ride / update meters
      </button>
      <LogRideSheet v-model:open="sheetOpen" :bike-id="data.bike.id" :current="data.latestReading" @saved="onSaved" />
      <MarkDoneSheet v-model:open="doneOpen" :bike-id="data.bike.id" :items="data.items" :current="data.latestReading" :item-id="doneItemId" @saved="onSaved" />
      <h2 class="mb-1.5 mt-4 text-[11px] uppercase tracking-widest text-muted">Maintenance · due soonest first</h2>
      <ul class="space-y-2">
        <li v-for="it in data.items" :key="it.id" class="flex items-center justify-between gap-2 rounded-xl bg-surface px-3 py-2.5 text-sm" data-testid="item-row">
          <span class="min-w-0">
            <span class="block font-semibold text-white">{{ it.name }}</span>
            <span :class="tone(it.status.state)" data-testid="item-state">{{ stateText(it) }}</span>
          </span>
          <button
            type="button"
            class="shrink-0 rounded-full bg-bg px-3 py-1.5 text-xs font-semibold text-accent"
            :aria-label="`Mark ${it.name} done`"
            data-testid="mark-done"
            @click="markDone(it.id)"
          >
            Mark done
          </button>
        </li>
      </ul>
    </template>
  </main>
</template>
