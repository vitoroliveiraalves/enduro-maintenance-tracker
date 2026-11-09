<script setup lang="ts">
import { formatHoursLong } from '~/lib/format'
import { parseDecimal } from '~/lib/parse-number'
import { errorMessage } from '~/offline/outbox'

type Detail = Record<string, unknown>
type Meters = { hoursTenths: number | null; km: number | null }
type ApiError = { statusCode?: number; data?: { error?: string; warn?: string; last?: Meters | null } }

const props = withDefaults(defineProps<{ bikeId: string; current: Meters | null; meters?: BikeMeters }>(), { meters: 'hours_km' })
const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ saved: [detail: Detail] }>()

const { mutate } = useApi()
const { hours, km } = useFormatters()
const online = useOnline()

// Conditions only weigh hours, so a km-only bike never sees them.
const hasHours = computed(() => countsHours(props.meters))
const hasKm = computed(() => countsKm(props.meters))
const title = computed(() => `Log ride / update ${hasHours.value && hasKm.value ? 'meters' : hasHours.value ? 'hours' : 'km'}`)

const CONDITIONS = [
  { key: 'normal', label: 'Normal' },
  { key: 'mud', label: 'Mud' },
  { key: 'sand', label: 'Sand' },
  { key: 'dust', label: 'Dust' },
  { key: 'race', label: 'Race' },
] as const

const hoursText = ref('')
const kmText = ref('')
const condition = ref<(typeof CONDITIONS)[number]['key']>('normal')
const error = ref('')
const jump = ref('')
const busy = ref(false)
// One id per "log this ride" intent: a double tap or a retry can never create two readings.
let clientId = crypto.randomUUID()

watch(open, (isOpen) => {
  if (!isOpen) return
  const c = props.current
  hoursText.value = c?.hoursTenths != null ? String(c.hoursTenths / 10) : ''
  kmText.value = c?.km != null ? String(c.km) : ''
  condition.value = 'normal'
  error.value = ''
  jump.value = ''
}, { immediate: true })

/** Difference in one meter, only when both sides have it. */
const diff = (a: number | null | undefined, b: number | null | undefined) => (a != null && b != null ? a - b : 0)

function jumpText(last: Meters, next: Meters): string {
  const parts: string[] = []
  if (diff(next.hoursTenths, last.hoursTenths) > 500) parts.push(formatHoursLong(diff(next.hoursTenths, last.hoursTenths)))
  if (diff(next.km, last.km) > 1500) parts.push(km(diff(next.km, last.km)))
  return `That's ${parts.join(' and ')} more than last time. Save anyway?`
}

async function save(confirmBigJump = false) {
  if (busy.value) return
  error.value = ''
  const h = hasHours.value ? parseDecimal(hoursText.value) : 0
  const k = hasKm.value ? parseDecimal(kmText.value) : 0
  if (h === null || h < 0 || k === null || k < 0) {
    jump.value = ''
    return void (error.value = `Enter ${hasHours.value && hasKm.value ? 'hours and km' : hasHours.value ? 'hours' : 'km'} as numbers.`)
  }
  const next: Meters = { hoursTenths: hasHours.value ? Math.round(h * 10) : null, km: hasKm.value ? Math.round(k) : null }
  if ((next.hoursTenths ?? 0) > 10_000_000 || (next.km ?? 0) > 10_000_000) {
    jump.value = ''
    return void (error.value = 'That is more than any bike has done. Check the number.')
  }
  // Offline the server can't check it now: run the same checks against the last
  // synced reading, so the rider fixes a typo here rather than after it syncs.
  const last = props.current
  if (!online.value && last) {
    if (diff(next.hoursTenths, last.hoursTenths) < 0) return void ((jump.value = ''), (error.value = `Hours can't go down (last: ${hours(last.hoursTenths!)})`))
    if (diff(next.km, last.km) < 0) return void ((jump.value = ''), (error.value = `Km can't go down (last: ${km(last.km!)})`))
    if (!confirmBigJump && (diff(next.hoursTenths, last.hoursTenths) > 500 || diff(next.km, last.km) > 1500)) return void (jump.value = jumpText(last, next))
  }
  busy.value = true
  try {
    // `at` is when the rider logged it, not when an offline queue gets it to the server.
    // Only counted meters (and conditions only with hours) are sent.
    const detail = await mutate<Detail>(
      '/api/readings',
      {
        clientId, bikeId: props.bikeId, at: new Date().toISOString(),
        ...(next.hoursTenths !== null ? { hoursTenths: next.hoursTenths } : {}),
        ...(next.km !== null ? { km: next.km } : {}),
        condition: hasHours.value ? condition.value : 'normal', confirmBigJump,
      },
      { queue: true },
    )
    clientId = crypto.randomUUID()
    jump.value = ''
    open.value = false
    emit('saved', detail)
  } catch (e) {
    const { statusCode, data } = e as ApiError
    const last = data?.last
    if (statusCode === 409 && data?.warn === 'big-jump' && last) {
      jump.value = jumpText(last, next)
    } else if (data?.error === 'hours-decreased' && last?.hoursTenths != null) {
      jump.value = ''
      error.value = `Hours can't go down (last: ${hours(last.hoursTenths)})`
    } else if (data?.error === 'km-decreased' && last?.km != null) {
      jump.value = ''
      error.value = `Km can't go down (last: ${km(last.km)})`
    } else if (data?.error === 'hours-exceed-later' && last?.hoursTenths != null) {
      jump.value = ''
      error.value = `Hours can't be above a later reading (${hours(last.hoursTenths)})`
    } else if (data?.error === 'km-exceed-later' && last?.km != null) {
      jump.value = ''
      error.value = `Km can't be above a later reading (${km(last.km)})`
    } else {
      error.value = errorMessage(e, 'Could not save the reading. Try again.', true)
    }
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <Sheet v-model:open="open" :title="title" testid="log-sheet">
    <form @submit.prevent="save(false)">
      <div class="flex gap-2.5">
        <label v-if="hasHours" class="flex-1 text-[11px] uppercase tracking-wider text-muted">
          Hours
          <input
            v-model="hoursText"
            inputmode="decimal"
            autocomplete="off"
            data-testid="hours-input"
            class="mt-1 block w-full rounded-xl bg-bg px-3 py-3 text-2xl font-bold normal-case text-white outline-none focus:ring-2 focus:ring-accent"
            @input="jump = ''"
          >
        </label>
        <label v-if="hasKm" class="flex-1 text-[11px] uppercase tracking-wider text-muted">
          Km
          <input
            v-model="kmText"
            inputmode="decimal"
            autocomplete="off"
            data-testid="km-input"
            class="mt-1 block w-full rounded-xl bg-bg px-3 py-3 text-2xl font-bold normal-case text-white outline-none focus:ring-2 focus:ring-accent"
            @input="jump = ''"
          >
        </label>
      </div>
      <div v-if="hasHours" class="mt-3 flex gap-1.5" role="radiogroup" aria-label="Conditions">
        <button
          v-for="c in CONDITIONS"
          :key="c.key"
          type="button"
          role="radio"
          :aria-checked="condition === c.key"
          :data-testid="`cond-${c.key}`"
          class="flex-1 rounded-full px-1 py-2 text-sm font-semibold"
          :class="condition === c.key ? 'bg-accent text-on-accent' : 'bg-bg text-muted'"
          @click="condition = c.key"
        >
          {{ c.label }}
        </button>
      </div>
      <p v-if="error" role="alert" class="mt-3 text-sm text-danger-text" data-testid="log-error">{{ error }}</p>
      <div v-if="jump" class="mt-3 rounded-xl bg-bg p-3" data-testid="jump-prompt">
        <p class="text-sm text-warn-text">{{ jump }}</p>
        <div class="mt-2 flex gap-2">
          <button type="button" class="flex-1 rounded-xl bg-accent py-2.5 font-bold text-on-accent" :disabled="busy" @click="save(true)">Save anyway</button>
          <button type="button" class="flex-1 rounded-xl bg-surface py-2.5 font-semibold text-white" @click="jump = ''">Fix it</button>
        </div>
      </div>
      <button v-if="!jump" type="submit" :disabled="busy" class="mt-4 w-full rounded-xl bg-accent py-3.5 text-base font-bold text-on-accent disabled:opacity-60">Save</button>
    </form>
  </Sheet>
</template>
