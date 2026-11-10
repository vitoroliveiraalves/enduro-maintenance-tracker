<script setup lang="ts">
import { tick } from '~/lib/haptics'
const { t } = useI18n()
const route = useRoute()

const HIDDEN = ['/login', '/register']
const visible = computed(() => !HIDDEN.includes(route.path))

const tabs = computed(() => [
  { key: 'garage', label: t.value.tabs.garage, icon: 'garage', to: '/', active: route.path === '/' || route.path.startsWith('/bikes') },
  { key: 'history', label: t.value.tabs.history, icon: 'history', to: '/history', active: route.path.startsWith('/history') },
  { key: 'invoice', label: t.value.tabs.invoice, icon: 'invoice', to: '/invoice', active: route.path.startsWith('/invoice') },
  { key: 'costs', label: t.value.tabs.costs, icon: 'costs', to: '/costs', active: route.path.startsWith('/costs') },
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
      v-for="tab in tabs"
      :key="tab.key"
      :to="tab.to"
      :data-testid="`tab-${tab.key}`"
      class="flex h-full flex-1 flex-col items-center justify-center gap-1"
      :class="tab.active ? 'tab-active font-semibold' : ''"
      :aria-current="tab.active ? 'page' : undefined"
      @click="tick()"
    >
      <Icon :name="tab.icon as 'garage'" />
      {{ tab.label }}
    </NuxtLink>
  </nav>
</template>
