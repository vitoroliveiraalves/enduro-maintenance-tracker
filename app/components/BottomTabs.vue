<script setup lang="ts">
import { tick } from '~/lib/haptics'
const route = useRoute()

const HIDDEN = ['/login', '/register']
const visible = computed(() => !HIDDEN.includes(route.path))

const tabs = computed(() => [
  { key: 'garage', label: 'Garage', icon: 'garage', to: '/', active: route.path === '/' || route.path.startsWith('/bikes') },
  { key: 'history', label: 'History', icon: 'history', to: '/history', active: route.path.startsWith('/history') },
  { key: 'invoice', label: 'Invoice', icon: 'invoice', to: '/invoice', active: route.path.startsWith('/invoice') },
  { key: 'costs', label: 'Costs', icon: 'costs', to: '/costs', active: route.path.startsWith('/costs') },
])
</script>

<template>
  <nav
    v-if="visible"
    data-testid="bottom-tabs"
    class="fixed inset-x-0 bottom-0 z-20 flex items-stretch justify-around border-t-[1.5px] border-text bg-bg font-tag text-[11px] uppercase tracking-[0.06em] text-muted"
    style="height: calc(3.5rem + env(safe-area-inset-bottom)); padding-bottom: env(safe-area-inset-bottom)"
  >
    <NuxtLink
      v-for="t in tabs"
      :key="t.key"
      :to="t.to"
      :data-testid="`tab-${t.key}`"
      class="flex h-full flex-1 flex-col items-center justify-center gap-1"
      :class="t.active ? 'tab-active font-semibold' : ''"
      :aria-current="t.active ? 'page' : undefined"
      @click="tick()"
    >
      <Icon :name="t.icon as 'garage'" />
      {{ t.label }}
    </NuxtLink>
  </nav>
</template>
