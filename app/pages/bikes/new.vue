<script setup lang="ts">
import { parseDecimal } from '~/lib/parse-number'
import { errorMessage } from '~/offline/outbox'
import { itemLabel } from '~/lib/server-text'
const { t } = useI18n()

type Draft = {
  key: number
  name: string
  hours: string
  km: string
  months: string
  multipliers: Record<string, number>
  lastAt: string
  lastHours: string
  lastKm: string
}
type Template = { name: string; everyHoursTenths?: number; everyKm?: number; everyMonths?: number; conditionMultipliers: Record<string, number> }

const { get, mutate } = useApi()
const store = useBikesStore()

const step = ref<1 | 2>(1)
const form = reactive({
  vehicleType: 'motorcycle' as 'motorcycle' | 'car',
  name: '',
  make: '',
  model: '',
  plate: '',
  year: String(new Date().getFullYear()),
  stroke: '2T' as '2T' | '4T',
  meters: 'hours_km' as BikeMeters,
  hours: '',
  km: '',
})
const drafts = ref<Draft[]>([])
const error = ref('')
const busy = ref(false)
let seq = 0

function onVehicleTypeChange() {
  if (form.vehicleType === 'car') {
    form.meters = 'km'
    form.stroke = '4T'
  } else {
    form.meters = 'hours_km'
    form.stroke = '2T'
  }
}

const hasHours = computed(() => form.vehicleType !== 'car' && countsHours(form.meters))
const hasKm = computed(() => countsKm(form.meters))
const metersNeeded = computed(() => (hasHours.value && hasKm.value ? 'meters' : hasHours.value ? 'hours' : 'km'))

const tenthsToText = (v?: number) => (v ? String(v / 10) : '')
function blank(over: Partial<Draft> = {}): Draft {
  return { key: ++seq, name: '', hours: '', km: '', months: '', multipliers: {}, lastAt: '', lastHours: '', lastKm: '', ...over }
}

async function next() {
  error.value = ''
  if (!form.name.trim() || !form.make.trim() || !form.model.trim()) return void (error.value = t.value.newBike.needNames)
  const year = parseDecimal(form.year)
  if (year === null || !Number.isInteger(year) || year < 1950 || year > 2100) return void (error.value = t.value.newBike.badYear)
  if ((hasHours.value && parseDecimal(form.hours) === null) || (hasKm.value && parseDecimal(form.km) === null)) {
    return void (error.value = t.value.newBike.needMeters(metersNeeded.value))
  }
  busy.value = true
  try {
    const url = form.vehicleType === 'car' ? '/api/templates/4T?type=car&meters=km' : `/api/templates/${form.stroke}?meters=${form.meters}`
    const tpl = await get<Template[]>(url)
    drafts.value = tpl.map((it) =>
      blank({
        name: itemLabel(it.name), // the driver's/rider's language; stored as typed
        hours: tenthsToText(it.everyHoursTenths),
        km: it.everyKm ? String(it.everyKm) : '',
        months: it.everyMonths ? String(it.everyMonths) : '',
        multipliers: it.conditionMultipliers,
      }),
    )
    step.value = 2
  } catch (e) {
    error.value = errorMessage(e, t.value.newBike.loadFailed, true)
  } finally {
    busy.value = false
  }
}

function optional(text: string, label: string, scale = 1): number | null | undefined {
  if (!text.trim()) return null
  const n = parseDecimal(text)
  if (n === null || n < 0) {
    error.value = t.value.newBike.invalid(label)
    return undefined
  }
  return Math.round(n * scale)
}

// One id per draft: a double tap or a retry after a lost response upserts the same vehicle.
const clientId = crypto.randomUUID()

async function save() {
  if (busy.value) return
  error.value = ''
  const items = []
  for (const d of drafts.value) {
    const label = d.name || t.value.newBike.item
    const nb = t.value.newBike
    // Only the units the vehicle counts are sent (hidden fields never leak a stale value).
    const everyHoursTenths = hasHours.value ? optional(d.hours, nb.hoursFor(label), 10) : null
    const everyKm = hasKm.value ? optional(d.km, nb.kmFor(label)) : null
    const everyMonths = optional(d.months, nb.monthsFor(label))
    if (everyHoursTenths === undefined || everyKm === undefined || everyMonths === undefined) return
    if (!d.name.trim()) return void (error.value = nb.needItemName)
    if (!everyHoursTenths && !everyKm && !everyMonths) return void (error.value = nb.needInterval(d.name))
    let lastDone: { at?: string; hoursTenths?: number; km?: number } | undefined
    // Whatever was typed counts, even if the section was folded again afterwards.
    const lastHours = hasHours.value ? d.lastHours : ''
    const lastKm = hasKm.value ? d.lastKm : ''
    if (lastHours.trim() || lastKm.trim() || d.lastAt.trim()) {
      const lh = optional(lastHours, nb.lastHoursFor(label), 10)
      const lk = optional(lastKm, nb.lastKmFor(label))
      if (lh === undefined || lk === undefined) return
      // No date given → none sent: the server records "date unknown", never a made-up today.
      lastDone = { ...(d.lastAt ? { at: d.lastAt } : {}), ...(lh !== null ? { hoursTenths: lh } : {}), ...(lk !== null ? { km: lk } : {}) }
    }
    items.push({
      name: d.name.trim(),
      ...(everyHoursTenths ? { everyHoursTenths } : {}),
      ...(everyKm ? { everyKm } : {}),
      ...(everyMonths ? { everyMonths } : {}),
      conditionMultipliers: { ...d.multipliers },
      ...(lastDone ? { lastDone } : {}),
    })
  }
  busy.value = true
  try {
    const bike = await mutate<{ id: string }>('/api/bikes', {
      clientId,
      name: form.name.trim(),
      make: form.make.trim(),
      model: form.model.trim(),
      year: Math.round(parseDecimal(form.year)!),
      vehicleType: form.vehicleType,
      ...(form.plate.trim() ? { plate: form.plate.trim() } : {}),
      stroke: form.stroke,
      meters: form.meters,
      ...(hasHours.value ? { hoursTenths: Math.round(parseDecimal(form.hours)! * 10) } : {}),
      ...(hasKm.value ? { km: Math.round(parseDecimal(form.km)!) } : {}),
      items,
    }, { queue: true })
    if (isQueued(bike)) return void (await navigateTo('/')) // shown in the garage as waiting to sync
    store.setLast(bike.id)
    useToast().show(t.value.newBike.added(form.name.trim()))
    await navigateTo(`/bikes/${bike.id}`)
  } catch (err) {
    error.value = errorMessage(err, t.value.newBike.failed)
  } finally {
    busy.value = false
  }
}

const field = 'mt-1 w-full rounded-lg border border-white/10 bg-surface px-3 py-3 text-base text-text outline-none focus:border-accent'
const small = 'mt-1 w-full rounded-lg border border-white/10 bg-bg px-2 py-2 text-base text-text outline-none focus:border-accent'
</script>

<template>
  <main class="mx-auto max-w-md lg:max-w-3xl p-4 lg:p-8 w-full">
    <div class="border-b border-text/10 pb-3 mb-4">
      <NuxtLink to="/" class="text-sm text-muted font-tag uppercase">‹ {{ t.newBike.garage }}</NuxtLink>
      <h1 class="mt-1 text-xl lg:text-3xl font-bold text-white tracking-tight">{{ t.newBike.title }}</h1>
      <p class="mt-0.5 text-xs text-muted font-tag" data-testid="step-indicator">{{ t.newBike.step(step) }}</p>
    </div>

    <form v-if="step === 1" class="mt-4 space-y-4" @submit.prevent="next">
      <!-- Vehicle Type Selector -->
      <fieldset class="block">
        <legend class="text-xs font-semibold uppercase tracking-wider text-muted font-tag">{{ t.newBike.vehicleType }}</legend>
        <div class="mt-1.5 flex gap-2">
          <label
            class="flex-1 cursor-pointer rounded-xl border px-3 py-2.5 text-center transition font-tag font-bold flex items-center justify-center gap-2"
            :class="form.vehicleType === 'motorcycle' ? 'border-accent text-accent-text bg-surface shadow-sm' : 'border-white/10 bg-surface/40 text-muted hover:text-text'"
            data-testid="type-motorcycle"
          >
            <input v-model="form.vehicleType" type="radio" value="motorcycle" class="sr-only" @change="onVehicleTypeChange">
            <span class="text-base">🏍️</span> {{ t.newBike.motorcycle }}
          </label>
          <label
            class="flex-1 cursor-pointer rounded-xl border px-3 py-2.5 text-center transition font-tag font-bold flex items-center justify-center gap-2"
            :class="form.vehicleType === 'car' ? 'border-accent text-accent-text bg-surface shadow-sm' : 'border-white/10 bg-surface/40 text-muted hover:text-text'"
            data-testid="type-car"
          >
            <input v-model="form.vehicleType" type="radio" value="car" class="sr-only" @change="onVehicleTypeChange">
            <span class="text-base">🚗</span> {{ t.newBike.car }}
          </label>
        </div>
      </fieldset>

      <label class="block"><span class="text-sm text-muted">{{ t.newBike.name }}</span>
        <input v-model="form.name" :class="field" autocomplete="off" data-testid="vehicle-name-input"></label>
      <div class="grid grid-cols-2 gap-3">
        <label class="block"><span class="text-sm text-muted">{{ t.newBike.make }}</span>
          <input v-model="form.make" :class="field" autocomplete="off" data-testid="vehicle-make-input"></label>
        <label class="block"><span class="text-sm text-muted">{{ t.newBike.model }}</span>
          <input v-model="form.model" :class="field" autocomplete="off" data-testid="vehicle-model-input"></label>
      </div>

      <div class="grid grid-cols-2 gap-3">
        <label class="block"><span class="text-sm text-muted">{{ t.newBike.year }}</span>
          <input v-model="form.year" inputmode="numeric" :class="field" data-testid="vehicle-year-input"></label>
        
        <!-- Car: License Plate | Motorcycle: Engine Stroke -->
        <label v-if="form.vehicleType === 'car'" class="block">
          <span class="text-sm text-muted">{{ t.newBike.plate }}</span>
          <input v-model="form.plate" :placeholder="t.newBike.platePh" class="uppercase font-tag tracking-wider" :class="field" data-testid="vehicle-plate-input">
        </label>
        <fieldset v-else class="block">
          <legend class="text-sm text-muted">{{ t.newBike.engine }}</legend>
          <div class="mt-1 flex gap-2">
            <label v-for="s in ['2T', '4T']" :key="s" class="flex-1 cursor-pointer rounded-lg border px-3 py-3 text-center" :class="form.stroke === s ? 'border-accent text-accent-text' : 'border-white/10 bg-surface'">
              <input v-model="form.stroke" type="radio" :value="s" class="sr-only">{{ s }}
            </label>
          </div>
        </fieldset>
      </div>

      <!-- Motorcycle: Optional License Plate -->
      <label v-if="form.vehicleType === 'motorcycle'" class="block">
        <span class="text-sm text-muted">{{ t.newBike.plate }} ({{ t.common.optional }})</span>
        <input v-model="form.plate" :placeholder="t.newBike.platePh" class="uppercase font-tag tracking-wider" :class="field" data-testid="vehicle-plate-input">
      </label>

      <!-- Motorcycle only: choose meters -->
      <MetersChoice v-if="form.vehicleType === 'motorcycle'" v-model="form.meters" />

      <!-- Current reading inputs -->
      <div class="grid gap-3" :class="hasHours && hasKm ? 'grid-cols-2' : 'grid-cols-1'">
        <label v-if="hasHours" class="block"><span class="text-sm text-muted">{{ t.newBike.currentHours }}</span>
          <input v-model="form.hours" inputmode="decimal" :placeholder="t.newBike.hoursPh" :class="field"></label>
        <label v-if="hasKm" class="block"><span class="text-sm text-muted">{{ t.newBike.currentKm }}</span>
          <input v-model="form.km" inputmode="decimal" :placeholder="t.newBike.kmPh" :class="field" data-testid="vehicle-km-input"></label>
      </div>
      <p v-if="error" role="alert" class="text-sm text-danger-text">{{ error }}</p>
      <button type="submit" :disabled="busy" class="w-full rounded-lg bg-accent py-3 font-semibold text-on-accent disabled:opacity-60" data-testid="vehicle-next-btn">{{ t.newBike.next }}</button>
    </form>

    <section v-else class="mt-4">
      <p class="text-sm text-muted">{{ t.newBike.adjust }}</p>
      <ul class="mt-4 space-y-3">
        <li v-for="d in drafts" :key="d.key" class="rounded-xl bg-surface p-3" data-testid="item-draft">
          <div class="flex items-center gap-2">
            <input v-model="d.name" :aria-label="t.newBike.itemName" class="min-w-0 flex-1 rounded-lg border border-white/10 bg-bg px-2 py-2 font-semibold text-white outline-none focus:border-accent">
            <button type="button" class="size-11 shrink-0 rounded-lg text-2xl leading-none text-muted" :aria-label="t.newBike.removeNamed(d.name)" @click="drafts = drafts.filter((x) => x.key !== d.key)">×</button>
          </div>
          <div class="mt-2 grid gap-2 text-xs text-muted" :class="hasHours && hasKm ? 'grid-cols-3' : 'grid-cols-2'">
            <label v-if="hasHours">{{ t.newBike.everyHours }}<input v-model="d.hours" inputmode="decimal" :aria-label="t.newBike.ariaEveryHours(d.name)" :class="small"></label>
            <label v-if="hasKm">{{ hasHours ? t.newBike.orKm : t.newBike.everyKm }}<input v-model="d.km" inputmode="numeric" :aria-label="t.newBike.ariaEveryKm(d.name)" :class="small"></label>
            <label>{{ t.newBike.orMonths }}<input v-model="d.months" inputmode="numeric" :aria-label="t.newBike.ariaEveryMonths(d.name)" :class="small"></label>
          </div>
          <details class="mt-2">
            <summary class="cursor-pointer text-sm text-accent-text">{{ t.newBike.lastDoneAt }}</summary>
            <div class="mt-2 grid gap-2 text-xs text-muted">
              <label>{{ t.common.date }} <span class="normal-case">{{ t.newBike.dateUnknownHint }}</span><input v-model="d.lastAt" type="date" :aria-label="t.newBike.ariaLastDate(d.name)" :class="small"></label>
              <div class="grid gap-2" :class="hasHours && hasKm ? 'grid-cols-2' : 'grid-cols-1'">
                <label v-if="hasHours">{{ t.common.hours }}<input v-model="d.lastHours" inputmode="decimal" :aria-label="t.newBike.ariaLastHours(d.name)" :class="small"></label>
                <label v-if="hasKm">{{ t.common.km }}<input v-model="d.lastKm" inputmode="numeric" :aria-label="t.newBike.ariaLastKm(d.name)" :class="small"></label>
              </div>
            </div>
          </details>
        </li>
      </ul>
      <button type="button" class="mt-3 w-full rounded-lg border border-white/15 py-3 text-sm font-semibold" @click="drafts.push(blank())">{{ t.newBike.addCustom }}</button>
      <p v-if="error" role="alert" class="mt-3 text-sm text-danger-text">{{ error }}</p>
      <div class="sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] z-10 -mx-4 mt-4 flex gap-3 bg-bg/95 px-4 py-3 backdrop-blur">
        <button type="button" class="rounded-lg border border-white/15 px-4 py-3" @click="step = 1">{{ t.newBike.back }}</button>
        <button type="button" :disabled="busy" class="flex-1 rounded-lg bg-accent py-3 font-semibold text-on-accent disabled:opacity-60" data-testid="vehicle-save-btn" @click="save">{{ t.newBike.save }}</button>
      </div>
    </section>
  </main>
</template>
