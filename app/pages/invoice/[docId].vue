<script setup lang="ts">
import { defaultCategory, matchLineToItems } from '../../../server/domain/invoice-match'
import type { LineKind } from '../../../server/domain/invoice-match'
import type { BikeSummary } from '../../../server/domain/item-row'
import { parseCents, parseDecimal, todayLocal } from '~/lib/parse-number'
import { errorMessage, statusOf } from '~/offline/outbox'

type Doc = {
  id: string
  status: 'reading' | 'review' | 'manual' | 'confirmed'
  supplierName: string | null
  supplierNif: string | null
  number: string | null
  issuedAt: string | null
  totalCents: number | null
  qrRaw: string | null
  error: string | null
  canRead: boolean
  extracted: { lines?: Array<{ description: string; totalCents: number | null; kind: LineKind; qty?: number }> } | null
  pages: Array<{ page: number; mime: string }>
  saved: Array<{ line: number | null; description: string; amountCents: number; bikeId: string | null; categoryName: string }>
}
type Category = { id: string; name: string; kind: string }
type Item = { id: string; name: string }
type Reading = { at: string; hoursTenths: number | null; km: number | null }
type Part = { id: string; name: string; unit: string; qtyHundredths: number; pending?: boolean }
type Line = {
  key: number
  description: string
  amountText: string
  categoryId: string
  itemIds: string[]
  open: boolean
  // "To the shelf": stock bought, not a service
  shelf: boolean
  shelfName: string
  shelfQtyText: string
  shelfUnit: string
  shelfPart: Part | null
  pickQuery: string
  movementId: string
  partClientId: string
}
const newLine = (key: number, over: Partial<Line> & Pick<Line, 'description' | 'amountText' | 'categoryId' | 'itemIds' | 'open'>): Line => ({
  key,
  shelf: false,
  shelfName: over.description.slice(0, 80),
  shelfQtyText: '1',
  shelfUnit: 'pcs',
  shelfPart: null,
  pickQuery: '',
  movementId: crypto.randomUUID(),
  partClientId: crypto.randomUUID(),
  ...over,
})

const MANUAL_NOTICE = "Couldn't read this invoice automatically. The photos are saved — add the lines yourself."
const POLL_MS = 2000

const route = useRoute()
const id = route.params.docId as string
const duplicate = route.query.duplicate === '1'
const qrNotice = typeof route.query.qrNotice === 'string' ? route.query.qrNotice : ''
const { get, mutate } = useApi()
const { money, date, qty } = useFormatters()
const store = useBikesStore()

const doc = ref<Doc | null>(null)
const notFound = ref(false)
const bikes = ref<BikeSummary[]>([])
const categories = ref<Category[]>([])
const items = ref<Item[]>([])
const readings = ref<Reading[]>([])

// The form
const garageName = ref('')
const nif = ref('')
const number = ref('')
const at = ref(todayLocal())
const bikeId = ref('')
const bikeMeters = computed<BikeMeters>(() => bikes.value.find((b) => b.id === bikeId.value)?.meters ?? 'hours_km')
const hasHours = computed(() => countsHours(bikeMeters.value))
const hasKm = computed(() => countsKm(bikeMeters.value))
const hoursText = ref('')
const kmText = ref('')
const metersTouched = ref(false)
const lines = ref<Line[]>([])
let lineSeq = 0
let formFor: string | null = null // status the form was filled from

const busy = ref(false)
const error = ref('')
const mismatch = ref<number | null>(null)
const askDiscard = ref(false)
let confirmClientId = crypto.randomUUID()
let timer: ReturnType<typeof setTimeout> | null = null

const isQr = computed(() => !!doc.value?.qrRaw)
const editable = computed(() => doc.value?.status === 'review' || doc.value?.status === 'manual')
const field = 'mt-1 block w-full rounded-xl bg-bg px-3 py-2.5 text-base normal-case text-white outline-none focus:ring-2 focus:ring-accent disabled:opacity-70'
const label = 'block text-[11px] uppercase tracking-wider text-muted'

const centsText = (c: number | null) => (c == null ? '' : (c / 100).toFixed(2).replace('.', ','))
const categoryFor = (kind: string) =>
  (categories.value.find((c) => c.kind === kind) ?? categories.value.find((c) => c.kind === 'other') ?? categories.value[0])?.id ?? ''
const itemName = (itemId: string) => items.value.find((i) => i.id === itemId)?.name ?? ''

async function load() {
  try {
    doc.value = await get<Doc>(`/api/documents/${id}`)
  } catch {
    notFound.value = true
    return
  }
  if (doc.value.status === 'reading') schedulePoll()
  else fillForm()
}

function schedulePoll() {
  if (timer) clearTimeout(timer)
  timer = setTimeout(async () => {
    timer = null
    await load()
  }, POLL_MS)
}

/** Fill the form once per reading result (and again after "Try reading again"). */
function fillForm() {
  const d = doc.value
  if (!d || !editable.value || formFor === d.status) return
  formFor = d.status
  garageName.value = d.supplierName ?? garageName.value
  nif.value = d.supplierNif ?? nif.value
  number.value = d.number ?? number.value
  at.value = d.issuedAt ?? at.value
  if (d.status === 'review' && d.extracted?.lines?.length) {
    lines.value = d.extracted.lines.map((l) =>
      newLine(++lineSeq, {
        description: l.description,
        amountText: centsText(l.totalCents),
        categoryId: categoryFor(defaultCategory(l.kind, l.description)),
        itemIds: matchLineToItems(l.description, items.value),
        open: false,
        shelfQtyText: String(l.qty != null && l.qty > 0 ? Math.round(l.qty * 100) / 100 : 1),
      }),
    )
  }
  defaultMeters()
}

async function loadBike() {
  if (!bikeId.value) return
  try {
    const [detail, rd] = await Promise.all([
      get<{ items: Item[] }>(`/api/bikes/${bikeId.value}`),
      get<Reading[]>(`/api/readings/${bikeId.value}`),
    ])
    items.value = detail.items.map((i) => ({ id: i.id, name: i.name }))
    readings.value = rd
  } catch {
    items.value = []
    readings.value = []
  }
  // Item ids belong to one bike: suggest again for the new one.
  for (const l of lines.value) l.itemIds = matchLineToItems(l.description, items.value)
  defaultMeters()
}

/**
 * Hours/km default to the latest reading on or before the invoice date (never a
 * later one: the service would look fresher than it was). None → left blank.
 */
function defaultMeters() {
  if (metersTouched.value) return
  const endOfDay = new Date(`${at.value}T23:59:59.999`).getTime()
  let best: Reading | null = null
  for (const r of readings.value) {
    const t = new Date(r.at).getTime()
    if (t <= endOfDay && (!best || t > new Date(best.at).getTime())) best = r
  }
  hoursText.value = hasHours.value && best?.hoursTenths != null ? (best.hoursTenths / 10).toFixed(1) : ''
  kmText.value = hasKm.value && best?.km != null ? String(best.km) : ''
}

watch(bikeId, loadBike)
watch(at, defaultMeters)

onMounted(async () => {
  try {
    const [b, c] = await Promise.all([get<BikeSummary[]>('/api/bikes'), get<Category[]>('/api/categories')])
    bikes.value = b
    categories.value = c
    bikeId.value = (b.find((x) => x.id === store.lastBikeId) ?? b[0])?.id ?? ''
    await loadBike()
  } catch {
    // the doc itself may still load; confirm will explain what's missing
  }
  await load()
})
onBeforeUnmount(() => {
  if (timer) clearTimeout(timer)
})

function addLine() {
  lines.value.push(newLine(++lineSeq, { description: '', amountText: '', categoryId: categoryFor('maintenance'), itemIds: [], open: true }))
  nextTick(() => document.querySelector<HTMLInputElement>(`[data-line-key="${lineSeq}"] input`)?.focus())
}
function removeLine(key: number) {
  lines.value = lines.value.filter((l) => l.key !== key)
}
const shelfParts = ref<Part[]>([])
let partsLoaded = false
async function setShelf(l: Line, on: boolean) {
  l.shelf = on
  if (on && !l.shelfName.trim()) l.shelfName = l.description.slice(0, 80)
  if (!on || partsLoaded) return
  partsLoaded = true
  try {
    shelfParts.value = await get<Part[]>('/api/parts')
  } catch {
    partsLoaded = false // the picker stays empty; a new part can still be typed
  }
}
const pickMatches = (l: Line) => {
  return l.pickQuery.trim() ? shelfParts.value.filter((p) => !p.pending && !p.id.startsWith('pending-') && matches(l.pickQuery, p.name)).slice(0, 5) : []
}
function pickPart(l: Line, p: Part | null) {
  l.shelfPart = p
  l.pickQuery = ''
  if (p) l.shelfUnit = p.unit
}
function toggleItem(l: Line, itemId: string) {
  l.itemIds = l.itemIds.includes(itemId) ? l.itemIds.filter((x) => x !== itemId) : [...l.itemIds, itemId]
}

const confirmLabel = computed(() => {
  const n = lines.value.length
  return n ? `Save ${n} line${n === 1 ? '' : 's'} · ${money(linesCents.value)}` : 'Save'
})

const linesCents = computed(() => lines.value.reduce((s, l) => s + (parseCents(l.amountText) ?? 0), 0))
const totals = computed(() => {
  const total = doc.value?.totalCents
  if (total == null || !lines.value.length) return null
  const diff = linesCents.value - total
  if (Math.abs(diff) <= Math.max(50, Math.round(total / 100))) return { ok: true, text: 'Lines match the invoice total ✓' }
  return { ok: false, text: `Lines are ${money(Math.abs(diff))} ${diff < 0 ? 'short of' : 'over'} the total` }
})

async function retryRead() {
  if (busy.value) return
  error.value = ''
  busy.value = true
  try {
    const res = await mutate<{ status: Doc['status'] }>(`/api/documents/${id}/read`, {})
    formFor = null
    if (res.status === 'reading' && doc.value) {
      doc.value.status = 'reading'
      schedulePoll()
    } else await load()
  } catch (e) {
    const { data } = e as { data?: { statusMessage?: string } }
    error.value = data?.statusMessage ?? 'Could not start reading. Try again.'
    await load()
  } finally {
    busy.value = false
  }
}

async function confirm(force = false) {
  if (busy.value) return
  error.value = ''
  if (!force) mismatch.value = null
  if (!bikeId.value) return void (error.value = 'Pick a bike.')
  if (!lines.value.length) return void (error.value = 'Add at least one line.')
  const out = []
  for (const [i, l] of lines.value.entries()) {
    const cents = parseCents(l.amountText)
    if (!l.description.trim()) return void (error.value = `Line ${i + 1}: add a description.`)
    if (cents === null) return void (error.value = `Line ${i + 1}: enter the amount, like 24,90.`)
    if (!l.categoryId) return void (error.value = `Line ${i + 1}: pick a category.`)
    let shelf
    if (l.shelf) {
      const q = parseDecimal(l.shelfQtyText)
      if (q === null || Math.round(q * 100) <= 0) return void (error.value = `Line ${i + 1}: enter the quantity, like 1,5.`)
      if (!l.shelfPart && !l.shelfName.trim()) return void (error.value = `Line ${i + 1}: name the part.`)
      shelf = l.shelfPart
        ? { clientId: l.movementId, partId: l.shelfPart.id, qtyHundredths: Math.round(q * 100) }
        : { clientId: l.movementId, partClientId: l.partClientId, name: l.shelfName.trim(), unit: l.shelfUnit.trim() || 'pcs', qtyHundredths: Math.round(q * 100) }
    }
    out.push({ description: l.description.trim(), amountCents: cents, categoryId: l.categoryId, itemIds: l.shelf ? [] : l.itemIds, ...(shelf ? { shelf } : {}) })
  }
  // Only the meters the chosen bike counts are sent.
  const h = hasHours.value && hoursText.value.trim() ? parseDecimal(hoursText.value) : undefined
  const k = hasKm.value && kmText.value.trim() ? parseDecimal(kmText.value) : undefined
  if (h === null || (h != null && h < 0)) return void (error.value = 'Enter the hours as a number, like 142,5.')
  if (k === null || (k != null && k < 0)) return void (error.value = 'Enter the km as a whole number.')
  busy.value = true
  try {
    await mutate(`/api/documents/${id}/confirm`, {
      clientId: confirmClientId,
      bikeId: bikeId.value,
      at: at.value,
      ...(h != null ? { hoursTenths: Math.round(h * 10) } : {}),
      ...(k != null ? { km: Math.round(k) } : {}),
      garageName: garageName.value.trim(),
      ...(isQr.value ? {} : { supplierNif: nif.value.trim(), number: number.value.trim() }),
      lines: out,
      forceTotals: force,
    })
    confirmClientId = crypto.randomUUID()
    useToast().show(`Invoice saved · ${out.length} line${out.length === 1 ? '' : 's'} · ${money(out.reduce((t, l) => t + l.amountCents, 0))}`)
    store.setLast(bikeId.value)
    await navigateTo(`/bikes/${bikeId.value}`)
  } catch (e) {
    const { data } = e as { data?: { error?: string; diffCents?: number; statusMessage?: string } }
    if (data?.error === 'totals-mismatch') mismatch.value = data.diffCents ?? 0
    else if (statusOf(e) === 409) {
      // Saved already (a retry after a lost answer, or another tab): that is what the rider wanted.
      useToast().show('Invoice already saved')
      store.setLast(bikeId.value)
      await navigateTo(`/bikes/${bikeId.value}`)
    } else error.value = errorMessage(e, 'Could not save. Try again.')
  } finally {
    busy.value = false
  }
}

async function discard() {
  busy.value = true
  try {
    await mutate(`/api/documents/${id}/discard`, {}, { method: 'DELETE' })
    await navigateTo('/invoice')
  } catch (e) {
    error.value = errorMessage(e, 'Could not discard. Try again.')
    askDiscard.value = false
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <main class="mx-auto max-w-md p-4 pb-28">
    <NuxtLink to="/invoice" class="-m-2 inline-block p-2 text-[13px] text-muted">‹ Invoices</NuxtLink>
    <h1 class="mt-1.5 text-xl font-bold text-white">{{ doc?.status === 'confirmed' ? 'Invoice' : 'Review invoice' }}</h1>

    <p v-if="notFound" role="alert" class="mt-4 text-danger">Invoice not found.</p>
    <template v-else-if="doc">
      <p v-if="duplicate" role="status" data-testid="duplicate-notice" class="mt-3 rounded-lg border border-warn/40 bg-warn/10 p-3 text-sm text-warn">
        This invoice was already uploaded
      </p>
      <p v-if="qrNotice" role="status" data-testid="qr-notice" class="mt-3 rounded-lg border border-white/15 bg-surface p-3 text-sm text-muted">
        {{ qrNotice }} The photos are kept; fill in the details below.
      </p>

      <InvoiceViewer class="mt-3" :doc-id="doc.id" :pages="doc.pages" />

      <p v-if="doc.status === 'reading'" role="status" data-testid="reading-status" class="mt-4 flex items-center gap-2 rounded-lg bg-surface p-3 text-sm">
        <span class="size-2.5 animate-pulse rounded-full bg-accent" /> Reading the invoice… this takes a few seconds.
      </p>

      <div v-if="doc.status === 'manual'" role="status" data-testid="manual-notice" class="mt-4 rounded-lg border border-warn/40 bg-warn/10 p-3 text-sm">
        <p class="text-warn">{{ MANUAL_NOTICE }}</p>
        <p v-if="doc.error" class="mt-1 text-muted" data-testid="manual-reason">{{ doc.error }}</p>
        <button
          v-if="doc.canRead"
          type="button"
          class="mt-2 rounded-lg border border-white/15 px-3 py-1.5 font-semibold disabled:opacity-50"
          :disabled="busy"
          data-testid="retry-read"
          @click="retryRead"
        >
          Try reading again
        </button>
      </div>

      <!-- Header -->
      <section class="mt-4 rounded-2xl bg-surface p-4" data-testid="invoice-header">
        <div class="flex items-center justify-between">
          <h2 class="font-semibold">Invoice</h2>
          <span v-if="doc.qrRaw" class="rounded bg-ok/15 px-2 py-0.5 text-xs text-ok" data-testid="qr-badge">From QR code</span>
        </div>
        <template v-if="doc.status === 'confirmed' || doc.status === 'reading'">
          <dl class="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt class="text-muted">Garage</dt>
            <dd data-testid="supplier-name">{{ doc.supplierName ?? '—' }}</dd>
            <dt class="text-muted">NIF</dt>
            <dd data-testid="supplier-nif">{{ doc.supplierNif ?? '—' }}</dd>
            <dt class="text-muted">Number</dt>
            <dd data-testid="invoice-number">{{ doc.number ?? '—' }}</dd>
            <dt class="text-muted">Date</dt>
            <dd>{{ doc.issuedAt ? date(doc.issuedAt) : '—' }}</dd>
            <dt class="text-muted">Total</dt>
            <dd data-testid="invoice-total">{{ doc.totalCents != null ? money(doc.totalCents) : '—' }}</dd>
          </dl>
        </template>
        <div v-else class="mt-3 grid gap-3">
          <label :class="label">
            Garage name
            <input v-model="garageName" autocomplete="off" maxlength="80" data-testid="inv-garage" :class="field">
          </label>
          <div class="grid grid-cols-2 gap-2.5">
            <label :class="label">
              NIF
              <input v-model="nif" :disabled="isQr" inputmode="numeric" maxlength="11" autocomplete="off" data-testid="supplier-nif" :class="field">
            </label>
            <label :class="label">
              Date
              <input v-model="at" type="date" :max="todayLocal()" :disabled="isQr && !!doc.issuedAt" data-testid="inv-date" :class="field">
            </label>
          </div>
          <div class="grid grid-cols-2 gap-2.5">
            <label :class="label">
              Number
              <input v-model="number" :disabled="isQr" maxlength="60" autocomplete="off" data-testid="invoice-number" :class="field">
            </label>
            <div :class="label">
              Total
              <p class="mt-1 rounded-xl px-1 py-2.5 text-base normal-case text-white" data-testid="invoice-total">
                {{ doc.totalCents != null ? money(doc.totalCents) : '—' }}
              </p>
            </div>
          </div>
        </div>
      </section>

      <!-- Saved invoice -->
      <section v-if="doc.status === 'confirmed'" class="mt-4 rounded-2xl bg-surface p-4" data-testid="saved-lines">
        <h2 class="font-semibold text-ok">Saved ✓</h2>
        <ul class="mt-2 divide-y divide-white/5 text-sm">
          <li v-for="s in doc.saved" :key="s.line ?? s.description" class="flex justify-between gap-3 py-2">
            <span>{{ s.description || '—' }} <span class="block text-xs text-muted">{{ s.categoryName }}</span></span>
            <span class="shrink-0 tabular-nums">{{ money(s.amountCents) }}</span>
          </li>
        </ul>
        <NuxtLink v-if="doc.saved[0]?.bikeId" :to="`/bikes/${doc.saved[0].bikeId}`" class="mt-2 inline-block text-sm text-accent underline">Open the bike</NuxtLink>
      </section>

      <template v-if="editable">
        <!-- Bike and meters at the time -->
        <section class="mt-4 rounded-2xl bg-surface p-4">
          <h2 class="font-semibold">Bike</h2>
          <p v-if="!bikes.length" class="mt-2 text-sm text-muted">
            <NuxtLink to="/bikes/new" class="text-accent underline">Add a bike</NuxtLink> first to save this invoice.
          </p>
          <template v-else>
            <label :class="[label, 'mt-3']">
              Bike
              <select v-model="bikeId" data-testid="inv-bike" :class="field">
                <option v-for="b in bikes" :key="b.id" :value="b.id">{{ b.name }}</option>
              </select>
            </label>
            <div class="mt-3 grid gap-2.5" :class="hasHours && hasKm ? 'grid-cols-2' : 'grid-cols-1'">
              <label v-if="hasHours" :class="label">
                Hours at the time
                <input v-model="hoursText" inputmode="decimal" autocomplete="off" data-testid="inv-hours" :class="field" @input="metersTouched = true">
              </label>
              <label v-if="hasKm" :class="label">
                Km at the time
                <input v-model="kmText" inputmode="numeric" autocomplete="off" data-testid="inv-km" :class="field" @input="metersTouched = true">
              </label>
            </div>
            <p v-if="(hoursText || kmText) && !metersTouched" class="mt-1.5 text-xs text-muted" data-testid="meters-hint">From your last reading before {{ date(at) }}</p>
            <p v-else-if="!hoursText && !kmText && !metersTouched && readings.length" class="mt-1.5 text-xs text-muted" data-testid="meters-missing">
              No reading on or before {{ date(at) }}: the {{ hasHours ? 'hours' : 'km' }} will be taken from your next reading. Enter them if you know them.
            </p>
          </template>
        </section>

        <!-- Lines -->
        <section class="mt-4" aria-label="Invoice lines">
          <h2 class="px-1 font-semibold">Lines</h2>
          <p v-if="!lines.length" class="mt-2 px-1 text-sm text-muted" data-testid="no-lines">No lines yet — add what's on the invoice.</p>
          <ul class="mt-2 grid gap-3">
            <li v-for="(l, i) in lines" :key="l.key" class="rounded-2xl bg-surface p-3" data-testid="inv-line" :data-line-key="l.key">
              <div class="flex items-start gap-2">
                <label class="flex-1" :class="label">
                  Line {{ i + 1 }}
                  <input v-model="l.description" maxlength="200" autocomplete="off" placeholder="Description" data-testid="line-desc" :class="field" @change="l.itemIds = l.itemIds.length ? l.itemIds : matchLineToItems(l.description, items)">
                </label>
                <button type="button" class="mt-5 size-10 shrink-0 rounded-lg text-xl text-muted" :aria-label="`Remove line ${i + 1}`" @click="removeLine(l.key)">×</button>
              </div>
              <div class="mt-2 grid grid-cols-[7.5rem_1fr] gap-2">
                <label :class="label">
                  Amount (€)
                  <input v-model="l.amountText" inputmode="decimal" autocomplete="off" data-testid="line-amount" :class="field">
                </label>
                <label :class="label">
                  Category
                  <select v-model="l.categoryId" data-testid="line-category" :class="field">
                    <option v-for="c in categories" :key="c.id" :value="c.id">{{ c.name }}</option>
                  </select>
                </label>
              </div>
              <div class="mt-2.5 grid grid-cols-2 gap-1 rounded-xl bg-bg p-1" role="group" :aria-label="`Line ${i + 1} destination`">
                <button
                  type="button"
                  class="min-h-11 rounded-lg text-sm font-semibold"
                  :class="l.shelf ? 'text-muted' : 'bg-accent text-black'"
                  :aria-pressed="!l.shelf"
                  data-testid="line-used"
                  @click="setShelf(l, false)"
                >
                  Used now
                </button>
                <button
                  type="button"
                  class="min-h-11 rounded-lg text-sm font-semibold"
                  :class="l.shelf ? 'bg-accent text-black' : 'text-muted'"
                  :aria-pressed="l.shelf"
                  data-testid="line-shelf"
                  @click="setShelf(l, true)"
                >
                  To the shelf
                </button>
              </div>
              <div v-if="l.shelf" class="mt-2.5 grid gap-2" data-testid="line-shelf-fields">
                <p v-if="l.shelfPart" class="flex items-center justify-between gap-2 rounded-xl bg-bg px-3 py-2 text-sm" data-testid="line-shelf-picked">
                  <span>Adds to <b>{{ l.shelfPart.name }}</b></span>
                  <button type="button" class="size-11 shrink-0 text-xl text-muted" :aria-label="`Don't add to ${l.shelfPart.name}`" @click="pickPart(l, null)">×</button>
                </p>
                <label v-else :class="label">
                  Part name
                  <input v-model="l.shelfName" maxlength="80" autocomplete="off" data-testid="line-shelf-name" :class="field">
                </label>
                <div class="grid grid-cols-[1fr_6rem] gap-2">
                  <label :class="label">
                    Quantity
                    <input v-model="l.shelfQtyText" inputmode="decimal" autocomplete="off" data-testid="line-shelf-qty" :class="field">
                  </label>
                  <label :class="label">
                    Unit
                    <input v-model="l.shelfUnit" maxlength="12" autocomplete="off" :disabled="!!l.shelfPart" data-testid="line-shelf-unit" :class="field">
                  </label>
                </div>
                <label v-if="!l.shelfPart" :class="label">
                  Same as a part on the shelf
                  <input v-model="l.pickQuery" autocomplete="off" placeholder="Search your parts" data-testid="line-shelf-pick" :class="field">
                </label>
                <ul v-if="pickMatches(l).length" class="grid gap-1">
                  <li v-for="p in pickMatches(l)" :key="p.id">
                    <button type="button" class="min-h-11 w-full rounded-xl border border-white/15 px-3 text-left text-sm" data-testid="line-shelf-option" @click="pickPart(l, p)">
                      {{ p.name }} <span class="text-muted">· {{ qty(p.qtyHundredths, p.unit) }}</span>
                    </button>
                  </li>
                </ul>
              </div>
              <div v-if="!l.shelf" class="mt-2.5 flex flex-wrap gap-1.5" data-testid="line-items">
                <button
                  v-for="itemId in l.itemIds"
                  :key="itemId"
                  type="button"
                  class="rounded-full bg-accent/20 px-2.5 py-1 text-sm text-accent"
                  aria-pressed="true"
                  data-testid="item-chip"
                  @click="toggleItem(l, itemId)"
                >
                  {{ itemName(itemId) }} ×
                </button>
                <button
                  v-if="items.length"
                  type="button"
                  class="rounded-full border border-white/15 px-2.5 py-1 text-sm text-muted"
                  :aria-expanded="l.open"
                  data-testid="link-items"
                  @click="l.open = !l.open"
                >
                  {{ l.itemIds.length ? 'Items' : 'Resets an item?' }} {{ l.open ? '▴' : '▾' }}
                </button>
              </div>
              <div v-if="l.open && !l.shelf" class="mt-2 flex flex-wrap gap-1.5">
                <button
                  v-for="it in items.filter((x) => !l.itemIds.includes(x.id))"
                  :key="it.id"
                  type="button"
                  class="rounded-full border border-white/15 px-2.5 py-1 text-sm"
                  aria-pressed="false"
                  data-testid="item-option"
                  @click="toggleItem(l, it.id)"
                >
                  + {{ it.name }}
                </button>
              </div>
            </li>
          </ul>
          <button type="button" class="mt-3 w-full rounded-xl border border-dashed border-white/20 py-3 font-semibold text-muted" data-testid="add-line" @click="addLine">
            + Add line
          </button>
        </section>

        <p
          v-if="totals"
          role="status"
          class="mt-4 px-1 text-sm font-semibold"
          :class="totals.ok ? 'text-ok-text' : 'text-warn-text'"
          data-testid="totals-check"
        >
          {{ totals.text }}
        </p>

        <div v-if="mismatch !== null" role="alert" class="mt-3 rounded-lg border border-warn/40 bg-warn/10 p-3 text-sm" data-testid="totals-mismatch">
          <p class="text-warn">The lines are {{ money(Math.abs(mismatch)) }} {{ mismatch < 0 ? 'short of' : 'over' }} the invoice total. Save anyway?</p>
          <button type="button" class="mt-2 rounded-lg bg-warn px-3 py-1.5 font-semibold text-black" :disabled="busy" data-testid="force-save" @click="confirm(true)">Save anyway</button>
        </div>
        <p v-if="error" role="alert" class="mt-3 text-sm text-danger" data-testid="inv-error">{{ error }}</p>

        <button
          type="button"
          class="mt-4 w-full rounded-xl bg-accent py-3.5 text-base font-bold text-black disabled:opacity-60"
          :disabled="busy || !bikes.length"
          data-testid="confirm"
          @click="confirm(false)"
        >
          {{ busy ? 'Saving…' : confirmLabel }}
        </button>
      </template>

      <template v-if="doc.status !== 'confirmed'">
        <button v-if="!askDiscard" type="button" class="mt-3 w-full py-2 text-sm text-muted underline" data-testid="discard" @click="askDiscard = true">
          Discard invoice
        </button>
        <div v-else role="alert" class="mt-3 rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm" data-testid="discard-ask">
          <p>Discard this invoice and its photos? This can't be undone.</p>
          <div class="mt-2 flex gap-2">
            <button type="button" class="rounded-lg bg-danger px-3 py-1.5 font-semibold text-black" :disabled="busy" data-testid="discard-confirm" @click="discard">Discard</button>
            <button type="button" class="rounded-lg border border-white/15 px-3 py-1.5" @click="askDiscard = false">Keep</button>
          </div>
        </div>
      </template>
    </template>
  </main>
</template>
