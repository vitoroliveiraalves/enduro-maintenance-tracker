<script setup lang="ts">
// Invoice photos captured offline (Ruling R12): a reminder while they wait
// (iOS: no Background Sync, and storage can be evicted), then a link to review
// each one once it has uploaded.
const route = useRoute()
const { invoicesWaiting, uploaded, forgetUploaded } = useOffline()
const HIDDEN = ['/login', '/register']
const visible = computed(() => !HIDDEN.includes(route.path))
const waitingText = computed(() => `${invoicesWaiting.value === 1 ? '1 invoice' : `${invoicesWaiting.value} invoices`} waiting to upload — keep the app open when online`)
</script>

<template>
  <div v-if="visible && (invoicesWaiting || uploaded.length)" class="mx-auto max-w-md px-4 pt-3">
    <p v-if="invoicesWaiting" role="status" class="rounded-lg border border-warn/40 bg-warn/10 p-3 text-sm text-warn-text" data-testid="invoices-waiting">
      {{ waitingText }}
    </p>
    <NuxtLink
      v-for="id in uploaded"
      :key="id"
      :to="`/invoice/${id}`"
      class="mt-2 block rounded-lg bg-surface p-3 text-sm font-semibold text-accent"
      data-testid="invoice-uploaded"
      @click="forgetUploaded(id)"
    >
      Invoice uploaded — review it ›
    </NuxtLink>
  </div>
</template>
