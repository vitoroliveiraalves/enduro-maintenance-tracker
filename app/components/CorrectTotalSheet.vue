<script setup lang="ts">
// Fix the bike's total after a mistake: rewrites the latest reading, up or down. Online only.
import { parseDecimal } from '~/lib/parse-number'
import { errorMessage } from '~/offline/outbox'

type Meters = { hoursTenths: number | null; km: number | null }

const props = defineProps<{ bikeId: string; current: Meters | null; meters: BikeMeters }>()
const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ saved: [detail: Record<string, unknown>] }>()

const { mutate } = useApi()
const online = useOnline()
const hasHours = computed(() => countsHours(props.meters))
const hasKm = computed(() => countsKm(props.meters))
const hoursText = ref('')
const kmText = ref('')
const error = ref('')
const busy = ref(false)

watch(open, (isOpen) => {
  if (!isOpen) return
  hoursText.value = props.current?.hoursTenths != null ? String(props.current.hoursTenths / 10) : ''
  kmText.value = props.current?.km != null ? String(props.current.km) : ''
  error.value = ''
}, { immediate: true })

async function save() {
  if (busy.value) return
  error.value = ''
  const h = hasHours.value ? parseDecimal(hoursText.value) : 0
  const k = hasKm.value ? parseDecimal(kmText.value) : 0
  if (h === null || h < 0 || k === null || k < 0) return void (error.value = 'Enter the totals as numbers.')
  if (h > 1_000_000 || k > 10_000_000) return void (error.value = 'That is more than any bike has done. Check the number.')
  busy.value = true
  try {
    const detail = await mutate<Record<string, unknown>>(
      `/api/bikes/${props.bikeId}/latest-reading`,
      { ...(hasHours.value ? { hoursTenths: Math.round(h * 10) } : {}), ...(hasKm.value ? { km: Math.round(k) } : {}) },
      { method: 'PATCH' },
    )
    open.value = false
    emit('saved', detail)
  } catch (e) {
    error.value = errorMessage(e, "Couldn't correct the total. Try again.", true)
  } finally {
    busy.value = false
  }
}

const field = 'mt-1 block w-full rounded-xl bg-bg px-3 py-3 text-2xl font-bold normal-case text-white outline-none focus:ring-2 focus:ring-accent'
</script>

<template>
  <Sheet v-model:open="open" title="Correct total" testid="correct-sheet">
    <form @submit.prevent="save">
      <p class="mb-3 text-sm text-muted">Type what the bike really shows. This replaces the last reading, so it can go down too.</p>
      <div class="flex gap-2.5">
        <label v-if="hasHours" class="flex-1 text-[11px] uppercase tracking-wider text-muted">
          Hours
          <input v-model="hoursText" inputmode="decimal" autocomplete="off" data-testid="correct-hours" :class="field">
        </label>
        <label v-if="hasKm" class="flex-1 text-[11px] uppercase tracking-wider text-muted">
          Km
          <input v-model="kmText" inputmode="decimal" autocomplete="off" data-testid="correct-km" :class="field">
        </label>
      </div>
      <p v-if="!online" class="mt-3 text-sm text-warn-text">Needs a connection to correct the total.</p>
      <p v-if="error" role="alert" class="mt-3 text-sm text-danger-text" data-testid="correct-error">{{ error }}</p>
      <button type="submit" :disabled="busy || !online" class="mt-4 w-full rounded-xl bg-accent py-3.5 text-base font-bold text-on-accent disabled:opacity-60" data-testid="correct-save">Save total</button>
    </form>
  </Sheet>
</template>
