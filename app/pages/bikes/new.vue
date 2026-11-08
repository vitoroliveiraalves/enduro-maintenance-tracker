<script setup lang="ts">
import { parseDecimal } from '~/lib/parse-number'

type Draft = {
  key: number
  name: string
  hours: string
  km: string
  months: string
  multipliers: Record<string, number>
  lastOpen: boolean
  lastAt: string
  lastHours: string
  lastKm: string
}
type Template = { name: string; everyHoursTenths?: number; everyKm?: number; everyMonths?: number; conditionMultipliers: Record<string, number> }

const { get, mutate } = useApi()
const store = useBikesStore()

const step = ref<1 | 2>(1)
const form = reactive({
  name: '',
  make: '',
  model: '',
  year: String(new Date().getFullYear()),
  stroke: '2T' as '2T' | '4T',
  hours: '',
  km: '',
})
const drafts = ref<Draft[]>([])
const error = ref('')
const busy = ref(false)
let seq = 0

const tenthsToText = (t?: number) => (t ? String(t / 10) : '')
const today = () => {
  const d = new Date() // local calendar date, not UTC
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function blank(over: Partial<Draft> = {}): Draft {
  return { key: ++seq, name: '', hours: '', km: '', months: '', multipliers: {}, lastOpen: false, lastAt: '', lastHours: '', lastKm: '', ...over }
}

async function next() {
  error.value = ''
  if (!form.name.trim() || !form.make.trim() || !form.model.trim()) return void (error.value = 'Fill in name, make and model.')
  const year = parseDecimal(form.year)
  if (year === null || !Number.isInteger(year) || year < 1950 || year > 2100) return void (error.value = 'Enter a valid year.')
  if (parseDecimal(form.hours) === null || parseDecimal(form.km) === null) return void (error.value = 'Enter the current hours and km.')
  busy.value = true
  try {
    const tpl = await get<Template[]>(`/api/templates/${form.stroke}`)
    drafts.value = tpl.map((t) =>
      blank({
        name: t.name,
        hours: tenthsToText(t.everyHoursTenths),
        km: t.everyKm ? String(t.everyKm) : '',
        months: t.everyMonths ? String(t.everyMonths) : '',
        multipliers: t.conditionMultipliers,
      }),
    )
    step.value = 2
  } catch {
    error.value = 'Could not load the item list. Try again.'
  } finally {
    busy.value = false
  }
}

function optional(text: string, label: string, scale = 1): number | null | undefined {
  if (!text.trim()) return null
  const n = parseDecimal(text)
  if (n === null || n < 0) {
    error.value = `Invalid ${label}.`
    return undefined
  }
  return Math.round(n * scale)
}

async function save() {
  error.value = ''
  const hoursTenths = Math.round(parseDecimal(form.hours)! * 10)
  const items = []
  for (const d of drafts.value) {
    const label = d.name || 'item'
    const everyHoursTenths = optional(d.hours, `hours interval for ${label}`, 10)
    const everyKm = optional(d.km, `km interval for ${label}`)
    const everyMonths = optional(d.months, `months interval for ${label}`)
    if (everyHoursTenths === undefined || everyKm === undefined || everyMonths === undefined) return
    if (!d.name.trim()) return void (error.value = 'Every item needs a name.')
    if (!everyHoursTenths && !everyKm && !everyMonths) return void (error.value = `${d.name}: set at least one interval.`)
    let lastDone: { at: string; hoursTenths?: number; km?: number } | undefined
    if (d.lastOpen && (d.lastHours.trim() || d.lastKm.trim() || d.lastAt.trim())) {
      const lh = optional(d.lastHours, `last done hours for ${label}`, 10)
      const lk = optional(d.lastKm, `last done km for ${label}`)
      if (lh === undefined || lk === undefined) return
      {
        lastDone = { at: d.lastAt || today(), ...(lh !== null ? { hoursTenths: lh } : {}), ...(lk !== null ? { km: lk } : {}) }
      }
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
      name: form.name.trim(),
      make: form.make.trim(),
      model: form.model.trim(),
      year: Math.round(parseDecimal(form.year)!),
      stroke: form.stroke,
      hoursTenths,
      km: Math.round(parseDecimal(form.km)!),
      items,
    })
    store.setLast(bike.id)
    await navigateTo(`/bikes/${bike.id}`)
  } catch (err) {
    const e = err as { data?: { statusMessage?: string } }
    error.value = e.data?.statusMessage ?? 'Could not save the bike. Try again.'
  } finally {
    busy.value = false
  }
}

const field = 'mt-1 w-full rounded-lg border border-white/10 bg-surface px-3 py-3 text-base text-text outline-none focus:border-accent'
const small = 'mt-1 w-full rounded-lg border border-white/10 bg-bg px-2 py-2 text-base text-text outline-none focus:border-accent'
</script>

<template>
  <main class="mx-auto max-w-md p-4">
    <NuxtLink to="/" class="text-sm text-muted">‹ Garage</NuxtLink>
    <h1 class="mt-2 text-2xl font-bold text-accent">Add bike</h1>

    <form v-if="step === 1" class="mt-4 space-y-4" @submit.prevent="next">
      <label class="block"><span class="text-sm text-muted">Name</span>
        <input v-model="form.name" :class="field" autocomplete="off"></label>
      <div class="grid grid-cols-2 gap-3">
        <label class="block"><span class="text-sm text-muted">Make</span>
          <input v-model="form.make" :class="field" autocomplete="off"></label>
        <label class="block"><span class="text-sm text-muted">Model</span>
          <input v-model="form.model" :class="field" autocomplete="off"></label>
      </div>
      <div class="grid grid-cols-2 gap-3">
        <label class="block"><span class="text-sm text-muted">Year</span>
          <input v-model="form.year" inputmode="numeric" :class="field"></label>
        <fieldset class="block">
          <legend class="text-sm text-muted">Engine</legend>
          <div class="mt-1 flex gap-2">
            <label v-for="s in ['2T', '4T']" :key="s" class="flex-1 cursor-pointer rounded-lg border px-3 py-3 text-center" :class="form.stroke === s ? 'border-accent text-accent' : 'border-white/10 bg-surface'">
              <input v-model="form.stroke" type="radio" :value="s" class="sr-only">{{ s }}
            </label>
          </div>
        </fieldset>
      </div>
      <div class="grid grid-cols-2 gap-3">
        <label class="block"><span class="text-sm text-muted">Current hours</span>
          <input v-model="form.hours" inputmode="decimal" placeholder="142,5" :class="field"></label>
        <label class="block"><span class="text-sm text-muted">Current km</span>
          <input v-model="form.km" inputmode="decimal" placeholder="3812" :class="field"></label>
      </div>
      <p v-if="error" role="alert" class="text-sm text-danger">{{ error }}</p>
      <button type="submit" :disabled="busy" class="w-full rounded-lg bg-accent py-3 font-semibold text-black disabled:opacity-60">Next: maintenance items</button>
    </form>

    <section v-else class="mt-4">
      <p class="text-sm text-muted">Adjust the service intervals. Open "Last done at" for anything you have already serviced; items without it show as unknown until you set it.</p>
      <ul class="mt-4 space-y-3">
        <li v-for="d in drafts" :key="d.key" class="rounded-xl bg-surface p-3" data-testid="item-draft">
          <div class="flex items-center gap-2">
            <input v-model="d.name" aria-label="Item name" class="min-w-0 flex-1 rounded-lg border border-white/10 bg-bg px-2 py-2 font-semibold text-white outline-none focus:border-accent">
            <button type="button" class="px-2 text-2xl leading-none text-muted" :aria-label="`Remove ${d.name}`" @click="drafts = drafts.filter((x) => x.key !== d.key)">×</button>
          </div>
          <div class="mt-2 grid grid-cols-3 gap-2 text-xs text-muted">
            <label>Every h<input v-model="d.hours" inputmode="decimal" :aria-label="`${d.name} every hours`" :class="small"></label>
            <label>Every km<input v-model="d.km" inputmode="numeric" :aria-label="`${d.name} every km`" :class="small"></label>
            <label>Every months<input v-model="d.months" inputmode="numeric" :aria-label="`${d.name} every months`" :class="small"></label>
          </div>
          <details class="mt-2" @toggle="d.lastOpen = ($event.target as HTMLDetailsElement).open">
            <summary class="cursor-pointer text-sm text-accent">Last done at</summary>
            <div class="mt-2 grid grid-cols-3 gap-2 text-xs text-muted">
              <label>Date<input v-model="d.lastAt" type="date" :aria-label="`${d.name} last done date`" :class="small"></label>
              <label>Hours<input v-model="d.lastHours" inputmode="decimal" :aria-label="`${d.name} last done hours`" :class="small"></label>
              <label>Km<input v-model="d.lastKm" inputmode="numeric" :aria-label="`${d.name} last done km`" :class="small"></label>
            </div>
          </details>
        </li>
      </ul>
      <button type="button" class="mt-3 w-full rounded-lg border border-white/15 py-3 text-sm font-semibold" @click="drafts.push(blank())">+ Add custom item</button>
      <p v-if="error" role="alert" class="mt-3 text-sm text-danger">{{ error }}</p>
      <div class="mt-4 flex gap-3">
        <button type="button" class="rounded-lg border border-white/15 px-4 py-3" @click="step = 1">Back</button>
        <button type="button" :disabled="busy" class="flex-1 rounded-lg bg-accent py-3 font-semibold text-black disabled:opacity-60" @click="save">Save bike</button>
      </div>
    </section>
  </main>
</template>
