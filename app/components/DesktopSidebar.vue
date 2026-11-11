<script setup lang="ts">
const route = useRoute()
const router = useRouter()
const store = useBikesStore()
const { t } = useI18n()
const { online, pending, invoicesWaiting, voiceWaiting, flush } = useOffline()

const HIDDEN = ['/login', '/register']
const visible = computed(() => !HIDDEN.includes(route.path))

onMounted(async () => {
  if (!store.loaded) {
    try {
      await store.fetchBikes()
    } catch {
      // offline fallback
    }
  }
  window.addEventListener('keydown', onKeydown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
})

const activeBike = computed(() => {
  const match = route.path.match(/^\/bikes\/([0-9a-fA-F-]+)/)
  if (match) {
    const found = store.bikes.find((b) => b.id === match[1])
    if (found) return found
  }
  if (store.lastBikeId) {
    const last = store.bikes.find((b) => b.id === store.lastBikeId)
    if (last) return last
  }
  return store.bikes[0] || null
})

const bikeStationUrl = computed(() => {
  return activeBike.value ? `/bikes/${activeBike.value.id}` : '/bikes/new'
})

const totalPending = computed(() => pending.value + invoicesWaiting.value + voiceWaiting.value)

function onSwitchBike(bikeId: string) {
  store.setLast(bikeId)
  router.push(`/bikes/${bikeId}`)
}

function onLogRide() {
  if (activeBike.value) {
    router.push({ path: `/bikes/${activeBike.value.id}`, query: { action: 'log-ride' } })
  } else {
    router.push('/bikes/new')
  }
}

function onRecordService() {
  if (activeBike.value) {
    router.push({ path: `/bikes/${activeBike.value.id}`, query: { action: 'record-service' } })
  } else {
    router.push('/bikes/new')
  }
}

function onKeydown(e: KeyboardEvent) {
  if (e.metaKey || e.ctrlKey || e.altKey) return
  const el = e.target as HTMLElement | null
  const tag = el?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable) return
  if (e.key === 'l' || e.key === 'L') {
    e.preventDefault()
    onLogRide()
  } else if (e.key === 's' || e.key === 'S') {
    e.preventDefault()
    onRecordService()
  }
}

const navLinks = computed(() => [
  {
    key: 'garage',
    label: t.value.desktop.nav.garage,
    icon: 'garage' as const,
    to: '/',
    active: route.path === '/',
  },
  {
    key: 'bikeStation',
    label: t.value.desktop.nav.bikeStation,
    icon: 'wrench' as const,
    to: bikeStationUrl.value,
    active: route.path.startsWith('/bikes') && route.path !== '/bikes/new',
    badge: activeBike.value?.counts?.overdue ? `${activeBike.value.counts.overdue}` : undefined,
  },
  {
    key: 'history',
    label: t.value.desktop.nav.history,
    icon: 'history' as const,
    to: '/history',
    active: route.path.startsWith('/history'),
  },
  {
    key: 'invoice',
    label: t.value.desktop.nav.invoice,
    icon: 'invoice' as const,
    to: '/invoice',
    active: route.path.startsWith('/invoice'),
  },
  {
    key: 'shelf',
    label: t.value.desktop.nav.shelf,
    icon: 'shelf' as const,
    to: '/shelf',
    active: route.path.startsWith('/shelf'),
  },
  {
    key: 'costs',
    label: t.value.desktop.nav.costs,
    icon: 'costs' as const,
    to: '/costs',
    active: route.path.startsWith('/costs'),
  },
  {
    key: 'settings',
    label: t.value.desktop.nav.settings,
    icon: 'settings' as const,
    to: '/settings',
    active: route.path.startsWith('/settings'),
  },
])
</script>

<template>
  <aside
    v-if="visible"
    data-testid="desktop-sidebar"
    class="hidden lg:flex lg:flex-col lg:w-72 lg:shrink-0 lg:h-dvh lg:sticky lg:top-0 bg-surface border-r border-text/15 select-none overflow-y-auto no-scrollbar z-30"
  >
    <!-- Brand Band (Stripes) -->
    <div class="brand-band w-full flex-none" aria-hidden="true" />

    <div class="p-5 flex flex-col flex-1 gap-6">
      <!-- Header: Logo, Brand & Sync Capsule -->
      <div class="flex flex-col gap-3">
        <div class="flex items-center gap-3">
          <BrandMark />
          <div class="min-w-0">
            <span class="block brand-slant text-lg font-black uppercase tracking-wider leading-tight text-text">
              DIRT GARAGE
            </span>
            <span class="block font-tag text-[10px] font-semibold tracking-[0.14em] text-muted uppercase">
              {{ t.desktop.subtitle }}
            </span>
          </div>
        </div>

        <!-- Live Online / Sync Capsule -->
        <button
          type="button"
          class="flex items-center gap-2 rounded border px-2.5 py-1 font-tag text-[11px] uppercase tracking-wider transition text-left w-fit"
          :class="
            !online
              ? 'border-danger/30 bg-danger/10 text-danger-text'
              : totalPending > 0
                ? 'border-warn/30 bg-warn/10 text-warn-text hover:bg-warn/20'
                : 'border-ok/30 bg-ok/10 text-ok-text hover:bg-ok/20'
          "
          :title="online ? 'Click to trigger immediate sync' : 'Offline mode'"
          data-testid="desktop-sync-status"
          @click="online && flush(true)"
        >
          <span
            class="size-2 rounded-full shrink-0"
            :class="
              !online
                ? 'bg-danger animate-pulse'
                : totalPending > 0
                  ? 'bg-warn animate-pulse'
                  : 'bg-emerald-400'
            "
          />
          <span class="font-semibold">
            {{
              !online
                ? t.desktop.status.offline
                : totalPending > 0
                  ? t.desktop.status.syncing(totalPending)
                  : t.desktop.status.onlineSynced
            }}
          </span>
        </button>
      </div>

      <!-- Active Vehicle Quick Switcher -->
      <div class="flex flex-col gap-1.5" data-testid="desktop-active-vehicle-card">
        <div class="flex items-center justify-between text-muted font-tag text-[10px] uppercase tracking-[0.14em] font-semibold">
          <span>{{ t.desktop.activeVehicle }}</span>
          <NuxtLink
            v-if="store.bikes.length"
            to="/bikes/new"
            class="text-accent-text hover:underline lowercase font-tag text-[11px]"
            title="Add another bike"
          >
            + add
          </NuxtLink>
        </div>

        <!-- If no bike registered -->
        <NuxtLink
          v-if="!activeBike"
          to="/bikes/new"
          class="flex items-center justify-center p-3 rounded border border-dashed border-text/30 bg-bg/50 font-tag text-xs font-semibold text-muted hover:border-accent hover:text-text transition"
          data-testid="desktop-add-bike-link"
        >
          {{ t.desktop.addVehicle }}
        </NuxtLink>

        <!-- Active Bike Card -->
        <div
          v-else
          class="rounded border border-text/25 bg-bg/60 p-3 flex flex-col gap-2.5 transition hover:border-text/40"
        >
          <NuxtLink
            :to="`/bikes/${activeBike.id}`"
            class="group block"
            :title="`Open ${activeBike.name}`"
          >
            <div class="flex items-start justify-between gap-1.5">
              <span class="brand-slant font-black text-base uppercase leading-tight truncate text-text group-hover:text-accent-text transition">
                {{ activeBike.name }}
              </span>
              <span
                v-if="activeBike.plate"
                class="rounded border border-text/30 bg-surface px-1.5 py-0.5 font-tag text-[10px] font-bold tracking-widest text-text shrink-0"
              >
                {{ activeBike.plate }}
              </span>
            </div>

            <div class="mt-1 flex items-center justify-between font-tag text-[11px] text-muted">
              <span class="truncate">
                {{ activeBike.vehicleType === 'car' ? '🚗' : '🏍️' }}
                {{ [activeBike.make, activeBike.model].filter(Boolean).join(' · ') || activeBike.year }}
              </span>
              <span
                v-if="activeBike.counts.overdue"
                class="rounded bg-danger/20 border border-danger/40 px-1 py-0.2 text-[10px] font-bold text-danger-text shrink-0"
              >
                {{ activeBike.counts.overdue }} overdue
              </span>
            </div>
          </NuxtLink>

          <!-- Fleet Switcher (shown when 2+ vehicles exist) -->
          <div v-if="store.bikes.length > 1" class="border-t border-text/10 pt-2 flex items-center gap-1.5">
            <label for="desktop-fleet-select" class="sr-only">{{ t.desktop.switchVehicle }}</label>
            <select
              id="desktop-fleet-select"
              :value="activeBike.id"
              class="w-full bg-surface border border-text/20 text-xs font-tag px-2 py-1 text-muted focus:text-text rounded outline-none focus:border-accent cursor-pointer"
              data-testid="desktop-bike-select"
              @change="onSwitchBike(($event.target as HTMLSelectElement).value)"
            >
              <option v-for="b in store.bikes" :key="b.id" :value="b.id">
                {{ b.name }} ({{ b.year }})
              </option>
            </select>
          </div>
        </div>
      </div>

      <!-- Quick Action Buttons -->
      <div class="flex flex-col gap-2">
        <button
          type="button"
          data-testid="desktop-action-log-ride"
          class="brand-slant w-full flex items-center justify-between bg-accent px-3.5 py-2.5 font-black uppercase text-xs tracking-wider text-on-accent transition hover:brightness-110 active:scale-[0.98]"
          @click="onLogRide"
        >
          <span>{{ t.desktop.actions.logRide }}</span>
          <kbd class="px-1.5 py-0.5 font-tag text-[10px] font-bold rounded bg-black/20 text-inherit border border-current/30 leading-none">
            {{ t.desktop.actions.hotkeyL }}
          </kbd>
        </button>

        <button
          type="button"
          data-testid="desktop-action-service"
          class="w-full flex items-center justify-between border border-text/30 bg-bg px-3.5 py-2.5 font-tag font-bold uppercase text-xs tracking-wider text-text transition hover:border-accent hover:text-accent-text active:scale-[0.98]"
          @click="onRecordService"
        >
          <span>{{ t.desktop.actions.recordService }}</span>
          <kbd class="px-1.5 py-0.5 font-tag text-[10px] font-bold rounded bg-surface text-muted border border-track leading-none">
            {{ t.desktop.actions.hotkeyS }}
          </kbd>
        </button>
      </div>

      <!-- Workshop Navigation -->
      <nav class="flex flex-col gap-1 mt-1" aria-label="Desktop Navigation">
        <NuxtLink
          v-for="link in navLinks"
          :key="link.key"
          :to="link.to"
          :data-testid="`desktop-nav-${link.key}`"
          class="group flex items-center justify-between px-3 py-2.5 rounded font-tag text-xs tracking-wider uppercase transition-colors"
          :class="
            link.active
              ? 'bg-bg text-text font-bold border-l-2 border-accent'
              : 'text-muted hover:text-text hover:bg-bg/50 border-l-2 border-transparent'
          "
          :aria-current="link.active ? 'page' : undefined"
        >
          <div class="flex items-center gap-3 min-w-0">
            <Icon :name="link.icon" :size="18" class="shrink-0 transition-transform group-hover:scale-105" />
            <span class="truncate">{{ link.label }}</span>
          </div>
          <span
            v-if="link.badge"
            class="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold bg-danger/20 text-danger-text border border-danger/40"
          >
            {{ link.badge }}
          </span>
        </NuxtLink>
      </nav>

      <!-- Footer / Shortcuts hint -->
      <div class="mt-auto pt-4 border-t border-text/10 flex flex-col gap-1 text-[11px] font-tag text-muted/60">
        <div class="flex items-center justify-between">
          <span>{{ t.desktop.shortcutsHint }}</span>
        </div>
      </div>
    </div>
  </aside>
</template>
