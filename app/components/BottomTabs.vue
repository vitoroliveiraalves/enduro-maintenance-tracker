<script setup lang="ts">
const route = useRoute()

const HIDDEN = ['/login', '/register']
const visible = computed(() => !HIDDEN.includes(route.path))

const tabs = computed(() => [
  { key: 'garage', label: 'Garage', to: '/', active: route.path === '/' || route.path.startsWith('/bikes') },
  { key: 'history', label: 'History', to: '/history', active: route.path.startsWith('/history') },
  { key: 'invoice', label: '📷 Invoice', to: '/invoice', active: route.path.startsWith('/invoice') },
  { key: 'costs', label: 'Costs', to: '/costs', active: route.path.startsWith('/costs') },
])
</script>

<template>
  <nav
    v-if="visible"
    data-testid="bottom-tabs"
    class="fixed inset-x-0 bottom-0 z-20 flex items-stretch justify-around border-t border-white/10 bg-bg text-[11px] text-muted"
    style="height: calc(3.5rem + env(safe-area-inset-bottom)); padding-bottom: env(safe-area-inset-bottom)"
  >
    <NuxtLink
      v-for="t in tabs"
      :key="t.key"
      :to="t.to"
      :data-testid="`tab-${t.key}`"
      class="flex h-full flex-1 items-center justify-center"
      :class="t.active ? 'font-bold text-accent' : ''"
    >
      {{ t.label }}
    </NuxtLink>
  </nav>
</template>
