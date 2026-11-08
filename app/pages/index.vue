<script setup lang="ts">
import { errorMessage } from '~/offline/outbox'

const store = useBikesStore()
const { hours, km } = useFormatters()
const { syncTick } = useOffline()
const error = ref('')
const signOutError = ref('')

async function load() {
  try {
    await store.fetchBikes()
    error.value = ''
  } catch {
    error.value = 'Could not load your bikes.'
  }
}
onMounted(load)
watch(syncTick, load)

async function signOut() {
  signOutError.value = ''
  try {
    await signOutEverywhere()
  } catch (e) {
    signOutError.value = errorMessage(e, "Couldn't sign out. Try again.")
  }
}
</script>

<template>
  <main class="mx-auto max-w-md p-4">
    <h1 class="text-2xl font-bold text-accent">Garage</h1>
    <p v-if="error" role="alert" class="mt-3 text-danger">{{ error }}</p>

    <ul v-if="store.bikes.length" class="mt-4 space-y-3" data-testid="bike-list">
      <li v-for="b in store.bikes" :key="b.id">
        <NuxtLink :to="`/bikes/${b.id}`" class="block rounded-xl bg-surface p-4" data-testid="bike-card">
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <div class="truncate text-lg font-bold text-white">{{ b.name }}</div>
              <div class="text-xs text-muted">{{ b.year }}</div>
            </div>
            <div class="flex shrink-0 gap-1.5">
              <span v-if="b.counts.overdue" class="rounded-full bg-danger/20 px-2 py-0.5 text-xs font-bold text-danger" data-testid="count-overdue">
                {{ b.counts.overdue }} overdue
              </span>
              <span v-if="b.counts.soon" class="rounded-full bg-warn/20 px-2 py-0.5 text-xs font-bold text-warn" data-testid="count-soon">
                {{ b.counts.soon }} soon
              </span>
            </div>
          </div>
          <div v-if="b.latestReading" class="mt-3 flex gap-6 text-sm">
            <span><b class="text-white">{{ hours(b.latestReading.hoursTenths) }}</b></span>
            <span><b class="text-white">{{ km(b.latestReading.km) }}</b></span>
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

    <NuxtLink
      to="/bikes/new"
      class="mt-5 block rounded-xl bg-accent py-3 text-center font-bold text-black"
      data-testid="add-bike"
    >
      + Add bike
    </NuxtLink>
    <button class="mt-8 text-sm text-muted underline" @click="signOut">Sign out</button>
    <p v-if="signOutError" role="alert" class="mt-2 text-sm text-danger">{{ signOutError }}</p>
  </main>
</template>
