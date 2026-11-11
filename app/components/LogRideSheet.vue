<script setup lang="ts">
import { formatHoursLong } from '~/lib/format'
import { parseDecimal } from '~/lib/parse-number'
import { downscaleImage } from '~/lib/image-downscale'
import { errorMessage } from '~/offline/outbox'
const { t } = useI18n()

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
const what = computed(() => (hasHours.value && hasKm.value ? 'meters' : hasHours.value ? 'hours' : 'km'))
const title = computed(() => t.value.logRide.title(what.value))

const CONDITION_KEYS = ['normal', 'mud', 'sand', 'dust', 'race'] as const
const CONDITIONS = computed(() => CONDITION_KEYS.map((key) => ({ key, label: t.value.logRide.conditions[key] })))

const hoursText = ref('')
const kmText = ref('')
const mode = ref<'total' | 'delta'>('total')
const deltaHoursText = ref('')
const deltaKmText = ref('')
const condition = ref<(typeof CONDITION_KEYS)[number]>('normal')
const error = ref('')
const jump = ref('')
const busy = ref(false)
const scanning = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)
// One id per "log this ride" intent: a double tap or a retry can never create two readings.
let clientId = crypto.randomUUID()

const hasCurrentReading = computed(() => (hasHours.value && props.current?.hoursTenths != null) || (hasKm.value && props.current?.km != null))

function setMode(m: 'total' | 'delta') {
  mode.value = m
  jump.value = ''
  error.value = ''
  if (m === 'delta') {
    if (hasHours.value && props.current?.hoursTenths != null) {
      const cur = parseDecimal(hoursText.value)
      const base = props.current.hoursTenths / 10
      if (cur != null && cur > base) {
        deltaHoursText.value = String(Math.round((cur - base) * 10) / 10)
      } else {
        deltaHoursText.value = ''
      }
    }
    if (hasKm.value && props.current?.km != null) {
      const cur = parseDecimal(kmText.value)
      const base = props.current.km
      if (cur != null && cur > base) {
        deltaKmText.value = String(Math.round(cur - base))
      } else {
        deltaKmText.value = ''
      }
    }
  }
}

function onDeltaHoursInput() {
  jump.value = ''
  if (!hasHours.value) return
  const d = parseDecimal(deltaHoursText.value)
  const base = (props.current?.hoursTenths ?? 0) / 10
  if (d != null && d >= 0) {
    hoursText.value = String(Math.round((base + d) * 10) / 10)
  } else if (!deltaHoursText.value.trim()) {
    hoursText.value = props.current?.hoursTenths != null ? String(props.current.hoursTenths / 10) : ''
  }
}

function onDeltaKmInput() {
  jump.value = ''
  if (!hasKm.value) return
  const d = parseDecimal(deltaKmText.value)
  const base = props.current?.km ?? 0
  if (d != null && d >= 0) {
    kmText.value = String(Math.round(base + d))
  } else if (!deltaKmText.value.trim()) {
    kmText.value = props.current?.km != null ? String(props.current.km) : ''
  }
}

const currentHoursFormatted = computed(() => hours(props.current?.hoursTenths ?? 0))
const parsedDeltaHoursFormatted = computed(() => {
  const d = parseDecimal(deltaHoursText.value)
  return d != null && d >= 0 ? hours(Math.round(d * 10)) : hours(0)
})
const computedHoursFormatted = computed(() => {
  const h = parseDecimal(hoursText.value)
  return h != null && h >= 0 ? hours(Math.round(h * 10)) : '—'
})

const currentKmFormatted = computed(() => km(props.current?.km ?? 0))
const parsedDeltaKmFormatted = computed(() => {
  const d = parseDecimal(deltaKmText.value)
  return d != null && d >= 0 ? km(Math.round(d)) : km(0)
})
const computedKmFormatted = computed(() => {
  const k = parseDecimal(kmText.value)
  return k != null && k >= 0 ? km(Math.round(k)) : '—'
})

async function onFileChanged(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  input.value = ''
  scanning.value = true
  error.value = ''
  jump.value = ''
  mode.value = 'total'
  try {
    const downscaled = await downscaleImage(file, 800, 0.8)
    const form = new FormData()
    form.append('bikeId', props.bikeId)
    form.append('file', downscaled, 'odometer.jpg')
    const res = await mutate<{ hours: number | null; km: number | null; confidence: string }>('/api/readings/scan', form)
    let found = false
    if (res.hours !== null && hasHours.value) {
      hoursText.value = String(res.hours)
      found = true
    }
    if (res.km !== null && hasKm.value) {
      kmText.value = String(res.km)
      found = true
    }
    if (!found) {
      error.value = t.value.logRide.scanUnreadable
    }
  } catch (err) {
    error.value = errorMessage(err, t.value.logRide.scanFailed, true)
  } finally {
    scanning.value = false
  }
}

watch(open, (isOpen) => {
  if (!isOpen) return
  mode.value = 'total'
  deltaHoursText.value = ''
  deltaKmText.value = ''
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
  return t.value.logRide.jump(parts)
}

async function save(confirmBigJump = false) {
  if (busy.value) return
  error.value = ''
  const h = hasHours.value ? parseDecimal(hoursText.value) : 0
  const k = hasKm.value ? parseDecimal(kmText.value) : 0
  if (h === null || h < 0 || k === null || k < 0) {
    jump.value = ''
    return void (error.value = t.value.logRide.asNumbers(what.value))
  }
  const next: Meters = { hoursTenths: hasHours.value ? Math.round(h * 10) : null, km: hasKm.value ? Math.round(k) : null }
  if ((next.hoursTenths ?? 0) > 10_000_000 || (next.km ?? 0) > 10_000_000) {
    jump.value = ''
    return void (error.value = t.value.correctTotal.tooBig)
  }
  // Offline the server can't check it now: run the same checks against the last
  // synced reading, so the rider fixes a typo here rather than after it syncs.
  const last = props.current
  if (!online.value && last) {
    if (diff(next.hoursTenths, last.hoursTenths) < 0) return void ((jump.value = ''), (error.value = t.value.errors.hoursDown(hours(last.hoursTenths!))))
    if (diff(next.km, last.km) < 0) return void ((jump.value = ''), (error.value = t.value.errors.kmDown(km(last.km!))))
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
      error.value = t.value.errors.hoursDown(hours(last.hoursTenths))
    } else if (data?.error === 'km-decreased' && last?.km != null) {
      jump.value = ''
      error.value = t.value.errors.kmDown(km(last.km))
    } else if (data?.error === 'hours-exceed-later' && last?.hoursTenths != null) {
      jump.value = ''
      error.value = t.value.errors.hoursAboveLater(hours(last.hoursTenths))
    } else if (data?.error === 'km-exceed-later' && last?.km != null) {
      jump.value = ''
      error.value = t.value.errors.kmAboveLater(km(last.km))
    } else {
      error.value = errorMessage(e, t.value.logRide.failed, true)
    }
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <Sheet v-model:open="open" :title="title" testid="log-sheet">
    <form @submit.prevent="save(false)">
      <div v-if="hasCurrentReading" class="mb-3.5 flex rounded-xl border border-white/10 bg-bg p-1 font-tag text-xs" role="tablist">
        <button
          type="button"
          role="tab"
          :aria-selected="mode === 'total'"
          data-testid="mode-total-btn"
          class="flex-1 rounded-lg py-2 font-semibold transition"
          :class="mode === 'total' ? 'bg-surface text-white shadow-sm' : 'text-muted hover:text-white'"
          @click="setMode('total')"
        >
          {{ t.logRide.modeTotal }}
        </button>
        <button
          type="button"
          role="tab"
          :aria-selected="mode === 'delta'"
          data-testid="mode-delta-btn"
          class="flex-1 rounded-lg py-2 font-semibold transition"
          :class="mode === 'delta' ? 'bg-surface text-white shadow-sm' : 'text-muted hover:text-white'"
          @click="setMode('delta')"
        >
          {{ t.logRide.modeDelta }}
        </button>
      </div>

      <div v-if="mode === 'delta'" class="space-y-2">
        <div class="flex items-end gap-2.5">
          <label v-if="hasHours" class="flex-1 text-[11px] uppercase tracking-wider text-muted">
            {{ t.logRide.deltaHours }}
            <input
              v-model="deltaHoursText"
              inputmode="decimal"
              autocomplete="off"
              placeholder="0.0"
              data-testid="delta-hours-input"
              class="mt-1 block w-full rounded-xl bg-bg px-3 py-3 text-2xl font-bold normal-case text-white outline-none focus:ring-2 focus:ring-accent"
              @input="onDeltaHoursInput"
            >
          </label>
          <label v-if="hasKm" class="flex-1 text-[11px] uppercase tracking-wider text-muted">
            {{ t.logRide.deltaKm }}
            <input
              v-model="deltaKmText"
              inputmode="decimal"
              autocomplete="off"
              placeholder="0"
              data-testid="delta-km-input"
              class="mt-1 block w-full rounded-xl bg-bg px-3 py-3 text-2xl font-bold normal-case text-white outline-none focus:ring-2 focus:ring-accent"
              @input="onDeltaKmInput"
            >
          </label>
          <button
            type="button"
            :disabled="scanning || busy"
            class="flex size-[54px] shrink-0 items-center justify-center rounded-xl bg-bg text-text transition-colors hover:bg-surface disabled:opacity-50"
            :aria-label="t.logRide.scan"
            data-testid="scan-odometer-btn"
            @click="fileInput?.click()"
          >
            <Icon v-if="!scanning" name="camera" :size="22" />
            <span v-else class="size-5 animate-spin rounded-full border-2 border-text border-t-transparent" aria-hidden="true" />
          </button>
        </div>

        <div class="rounded-xl border border-white/5 bg-surface/50 p-3 font-tag text-xs" data-testid="delta-preview">
          <div class="text-[10px] uppercase tracking-wider text-muted mb-1">{{ t.logRide.newTotal }}</div>
          <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-white font-medium">
            <span v-if="hasHours">
              {{ currentHoursFormatted }} + {{ parsedDeltaHoursFormatted }} = <b class="text-accent-text font-bold">{{ computedHoursFormatted }}</b>
            </span>
            <span v-if="hasKm">
              {{ currentKmFormatted }} + {{ parsedDeltaKmFormatted }} = <b class="text-accent-text font-bold">{{ computedKmFormatted }}</b>
            </span>
          </div>
        </div>
      </div>

      <div v-else class="flex items-end gap-2.5">
        <label v-if="hasHours" class="flex-1 text-[11px] uppercase tracking-wider text-muted">
          {{ t.common.hours }}
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
          {{ t.common.km }}
          <input
            v-model="kmText"
            inputmode="decimal"
            autocomplete="off"
            data-testid="km-input"
            class="mt-1 block w-full rounded-xl bg-bg px-3 py-3 text-2xl font-bold normal-case text-white outline-none focus:ring-2 focus:ring-accent"
            @input="jump = ''"
          >
        </label>
        <button
          type="button"
          :disabled="scanning || busy"
          class="flex size-[54px] shrink-0 items-center justify-center rounded-xl bg-bg text-text transition-colors hover:bg-surface disabled:opacity-50"
          :aria-label="t.logRide.scan"
          data-testid="scan-odometer-btn"
          @click="fileInput?.click()"
        >
          <Icon v-if="!scanning" name="camera" :size="22" />
          <span v-else class="size-5 animate-spin rounded-full border-2 border-text border-t-transparent" aria-hidden="true" />
        </button>
      </div>

      <input
        ref="fileInput"
        type="file"
        accept="image/jpeg,image/png"
        capture="environment"
        class="hidden"
        data-testid="odometer-file-input"
        @change="onFileChanged"
      >
      <p v-if="scanning" class="mt-2 text-xs font-semibold text-muted font-tag animate-pulse" data-testid="scan-status">{{ t.logRide.scanning }}</p>
      <div v-if="hasHours" class="mt-3 flex gap-1.5" role="radiogroup" :aria-label="t.logRide.conditionsLabel">
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
          <button type="button" class="flex-1 rounded-xl bg-accent py-2.5 font-bold text-on-accent" :disabled="busy" @click="save(true)">{{ t.logRide.saveAnyway }}</button>
          <button type="button" class="flex-1 rounded-xl bg-surface py-2.5 font-semibold text-white" @click="jump = ''">{{ t.logRide.fixIt }}</button>
        </div>
      </div>
      <button v-if="!jump" type="submit" :disabled="busy" class="mt-4 w-full rounded-xl bg-accent py-3.5 text-base font-bold text-on-accent disabled:opacity-60">{{ t.common.save }}</button>
    </form>
  </Sheet>
</template>
