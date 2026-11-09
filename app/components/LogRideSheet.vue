<script setup lang="ts">
import { formatHoursLong } from '~/lib/format'
import { parseDecimal } from '~/lib/parse-number'
import { errorMessage } from '~/offline/outbox'

type Detail = Record<string, unknown>
type Meters = { hoursTenths: number; km: number }
type ApiError = { statusCode?: number; data?: { error?: string; warn?: string; last?: Meters | null } }

const props = defineProps<{ bikeId: string; current: Meters | null }>()
const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ saved: [detail: Detail] }>()

const { mutate } = useApi()
const { hours, km } = useFormatters()
const online = useOnline()

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
  hoursText.value = props.current ? String(props.current.hoursTenths / 10) : ''
  kmText.value = props.current ? String(props.current.km) : ''
  condition.value = 'normal'
  error.value = ''
  jump.value = ''
}, { immediate: true })

function jumpText(last: Meters, next: Meters): string {
  const parts: string[] = []
  if (next.hoursTenths - last.hoursTenths > 500) parts.push(formatHoursLong(next.hoursTenths - last.hoursTenths))
  if (next.km - last.km > 1500) parts.push(km(next.km - last.km))
  return `That's ${parts.join(' and ')} more than last time. Save anyway?`
}

async function save(confirmBigJump = false) {
  if (busy.value) return
  error.value = ''
  const h = parseDecimal(hoursText.value)
  const k = parseDecimal(kmText.value)
  if (h === null || h < 0 || k === null || k < 0) {
    jump.value = ''
    return void (error.value = 'Enter hours and km as numbers.')
  }
  const next = { hoursTenths: Math.round(h * 10), km: Math.round(k) }
  if (next.hoursTenths > 10_000_000 || next.km > 10_000_000) {
    jump.value = ''
    return void (error.value = 'That is more than any bike has done. Check the number.')
  }
  // Offline the server can't check it now: run the same checks against the last
  // synced reading, so the rider fixes a typo here rather than after it syncs.
  const last = props.current
  if (!online.value && last) {
    if (next.hoursTenths < last.hoursTenths) return void ((jump.value = ''), (error.value = `Hours can't go down (last: ${hours(last.hoursTenths)})`))
    if (next.km < last.km) return void ((jump.value = ''), (error.value = `Km can't go down (last: ${km(last.km)})`))
    if (!confirmBigJump && (next.hoursTenths - last.hoursTenths > 500 || next.km - last.km > 1500)) return void (jump.value = jumpText(last, next))
  }
  busy.value = true
  try {
    // `at` is when the rider logged it, not when an offline queue gets it to the server.
    const detail = await mutate<Detail>(
      '/api/readings',
      { clientId, bikeId: props.bikeId, at: new Date().toISOString(), ...next, condition: condition.value, confirmBigJump },
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
    } else if (data?.error === 'hours-decreased' && last) {
      jump.value = ''
      error.value = `Hours can't go down (last: ${hours(last.hoursTenths)})`
    } else if (data?.error === 'km-decreased' && last) {
      jump.value = ''
      error.value = `Km can't go down (last: ${km(last.km)})`
    } else if (data?.error === 'hours-exceed-later' && last) {
      jump.value = ''
      error.value = `Hours can't be above a later reading (${hours(last.hoursTenths)})`
    } else if (data?.error === 'km-exceed-later' && last) {
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
  <Sheet v-model:open="open" title="Log ride / update meters" testid="log-sheet">
    <form @submit.prevent="save(false)">
      <div class="flex gap-2.5">
        <label class="flex-1 text-[11px] uppercase tracking-wider text-muted">
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
        <label class="flex-1 text-[11px] uppercase tracking-wider text-muted">
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
      <div class="mt-3 flex gap-1.5" role="radiogroup" aria-label="Conditions">
        <button
          v-for="c in CONDITIONS"
          :key="c.key"
          type="button"
          role="radio"
          :aria-checked="condition === c.key"
          :data-testid="`cond-${c.key}`"
          class="flex-1 rounded-full px-1 py-2 text-sm font-semibold"
          :class="condition === c.key ? 'bg-accent text-black' : 'bg-bg text-muted'"
          @click="condition = c.key"
        >
          {{ c.label }}
        </button>
      </div>
      <p v-if="error" role="alert" class="mt-3 text-sm text-danger" data-testid="log-error">{{ error }}</p>
      <div v-if="jump" class="mt-3 rounded-xl bg-bg p-3" data-testid="jump-prompt">
        <p class="text-sm text-warn">{{ jump }}</p>
        <div class="mt-2 flex gap-2">
          <button type="button" class="flex-1 rounded-xl bg-accent py-2.5 font-bold text-black" :disabled="busy" @click="save(true)">Save anyway</button>
          <button type="button" class="flex-1 rounded-xl bg-surface py-2.5 font-semibold text-white" @click="jump = ''">Fix it</button>
        </div>
      </div>
      <button v-if="!jump" type="submit" :disabled="busy" class="mt-4 w-full rounded-xl bg-accent py-3.5 text-base font-bold text-black disabled:opacity-60">Save</button>
    </form>
  </Sheet>
</template>
