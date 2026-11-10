<script setup lang="ts">
import { errorMessage, statusOf } from '~/offline/outbox'
import { readSession } from '~/offline/session'
import { resetVoiceStatus } from '~/composables/useVoice'

type Rider = {
  id: string
  email: string
  createdAt: string
  lastLoginAt: string | null
  aiEnabled: boolean
  counts: Record<'bikes' | 'services' | 'expenses' | 'invoices' | 'readings' | 'parts', number>
}

const COUNTS = ['bikes', 'services', 'expenses', 'invoices', 'readings', 'parts'] as const

const { get, mutate } = useApi()
const { t } = useI18n()
const { date } = useFormatters()
const riders = ref<Rider[] | null>(null)
const loadError = ref('')
const saveError = ref('')
const busy = ref<string | null>(null)
const me = readSession()?.email ?? ''

onMounted(async () => {
  try {
    riders.value = await get<Rider[]>('/api/admin/users')
  } catch (e) {
    // Not an admin: the API answers 404 and this screen does not exist.
    if (statusOf(e) === 404) return void navigateTo('/settings', { replace: true })
    loadError.value = t.value.admin.loadFailed
  }
})

const aiOn = computed(() => riders.value?.filter((r) => r.aiEnabled).length ?? 0)

async function toggle(r: Rider) {
  if (busy.value) return
  busy.value = r.id
  saveError.value = ''
  try {
    const res = await mutate<{ aiEnabled: boolean }>(`/api/admin/users/${r.id}`, { aiEnabled: !r.aiEnabled }, { method: 'PATCH' })
    r.aiEnabled = res.aiEnabled
    if (r.email === me) resetVoiceStatus()
  } catch (e) {
    saveError.value = errorMessage(e, t.value.admin.saveFailed, true)
  } finally {
    busy.value = null
  }
}
</script>

<template>
  <main class="mx-auto max-w-md px-4 pb-6 pt-[18px]">
    <div class="text-[13px] text-muted">
      <NuxtLink to="/settings" class="-m-2 p-2 font-tag text-xs">{{ t.admin.back }}</NuxtLink>
    </div>
    <h1 class="mt-2 text-[34px] text-white">{{ t.admin.title }}</h1>
    <p v-if="riders" class="font-tag text-[11px] uppercase tracking-[0.08em] text-muted" data-testid="admin-summary">{{ t.admin.summary(riders.length, aiOn) }}</p>

    <p v-if="loadError" role="alert" class="mt-4 text-sm text-danger-text">{{ loadError }}</p>
    <p v-if="saveError" role="alert" class="mt-4 text-sm text-danger-text" data-testid="admin-save-error">{{ saveError }}</p>

    <Skeleton v-if="!riders && !loadError" :rows="3" height="h-28" class="mt-4" />
    <ul v-else-if="riders" class="mt-4 grid gap-2">
      <li v-for="r in riders" :key="r.id" class="rounded-xl bg-surface p-3" data-testid="admin-rider">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <p class="break-all text-sm font-semibold text-white" data-testid="admin-email">
              {{ r.email }}
              <span v-if="r.email === me" class="ml-1 border border-text px-1 font-tag text-[10px] uppercase">{{ t.admin.you }}</span>
            </p>
            <p class="mt-0.5 font-tag text-[11px] text-muted">
              {{ t.admin.lastLogin(r.lastLoginAt ? date(r.lastLoginAt) : t.admin.never) }}
            </p>
            <p class="font-tag text-[11px] text-muted">{{ t.admin.joined(date(r.createdAt)) }}</p>
          </div>
          <div class="flex shrink-0 flex-col items-center gap-1">
            <span class="font-tag text-[10px] uppercase text-muted" aria-hidden="true">{{ t.admin.ai }}</span>
            <button
              type="button"
              role="switch"
              :aria-checked="r.aiEnabled"
              :aria-label="t.admin.aiFor(r.email)"
              :disabled="busy === r.id"
              data-testid="admin-ai-toggle"
              class="relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-60"
              :class="r.aiEnabled ? 'bg-accent' : 'bg-track'"
              @click="toggle(r)"
            >
              <span class="absolute top-1 h-5 w-5 rounded-full bg-white transition-all" :class="r.aiEnabled ? 'left-6' : 'left-1'" />
            </button>
          </div>
        </div>
        <dl class="mt-2.5 grid grid-cols-3 gap-1.5">
          <div v-for="c in COUNTS" :key="c" class="flex flex-col-reverse border border-white/15 px-2 py-1.5" :data-testid="`admin-count-${c}`">
            <dt class="font-tag text-[10px] uppercase text-muted">{{ t.admin.counts[c] }}</dt>
            <dd class="font-tag text-[15px] text-white">{{ r.counts[c] }}</dd>
          </div>
        </dl>
      </li>
    </ul>
  </main>
</template>
