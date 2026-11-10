<script setup lang="ts">
import { categoryLabel, itemLabel } from '~/lib/server-text'
import { parseCents, parseDecimal, todayLocal } from '~/lib/parse-number'
import { errorMessage } from '~/offline/outbox'
import { mergeUseLines, overdrawn } from '~/lib/parts-used'
import type { ShelfPart } from '~/lib/shelf'
import type { ItemRowJson } from '../../server/domain/item-row'
const { t } = useI18n()

type Detail = Record<string, unknown>
type Category = { id: string; name: string; kind: string }

const props = defineProps<{
  bikeId: string
  items: ItemRowJson[]
  current: { hoursTenths: number | null; km: number | null } | null
  itemId: string | null
  meters?: BikeMeters
}>()
const hasHours = computed(() => countsHours(props.meters ?? 'hours_km'))
const hasKm = computed(() => countsKm(props.meters ?? 'hours_km'))
const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ saved: [detail: Detail] }>()

const { get, mutate } = useApi()
const { qty: fmtQty } = useFormatters()

const at = ref(todayLocal())
const hoursText = ref('')
const kmText = ref('')
const by = ref<'diy' | 'garage'>('diy')
const garageName = ref('')
const picked = ref<string[]>([])
const costText = ref('')
const notesText = ref('')
const categoryId = ref('')
const categories = ref<Category[]>([])
const error = ref('')
const busy = ref(false)
// Parts used: the shelf (without parts still queued offline: the server does not know their ids yet),
// the rider's choice per part, and the parts added by hand with "Add from shelf".
type Use = { on: boolean; qtyText: string; anyway: boolean; clientId: string }
const shelf = ref<ShelfPart[]>([])
const use = ref<Record<string, Use>>({})
const addedIds = ref<string[]>([])
const addQuery = ref('')
const addOpen = ref(false)
const shelfLoading = ref(false)
let session = 0
// One id per "mark done" intent: a double tap or a retry can never create two services.
let clientId = crypto.randomUUID()

const itemName = computed(() => itemLabel(props.items.find((i) => i.id === props.itemId)?.name ?? '') || t.value.markDone.item)
const others = computed(() => props.items.filter((i) => i.id !== props.itemId))

const doneIds = computed(() => (props.itemId ? [props.itemId, ...picked.value] : picked.value))
const linked = computed(() => shelf.value.filter((p) => p.itemIds.some((id) => doneIds.value.includes(id))))
const shownParts = computed(() => {
  const ids = new Set(linked.value.map((p) => p.id))
  return [...linked.value, ...addedIds.value.filter((id) => !ids.has(id)).map((id) => shelf.value.find((p) => p.id === id)).filter((p): p is ShelfPart => !!p)]
})
const addOptions = computed(() => {
  const shownIds = new Set(shownParts.value.map((p) => p.id))
  return shelf.value.filter((p) => !shownIds.has(p.id) && matches(addQuery.value, p.name, p.bikeName)).slice(0, 6)
})
const wanted = (p: ShelfPart): number | null => {
  const u = use.value[p.id]
  const n = u ? parseDecimal(u.qtyText) : null
  return n !== null && n > 0 ? Math.round(n * 100) : null
}
const short = (p: ShelfPart) => {
  const u = use.value[p.id]
  const w = wanted(p)
  return !!u?.on && w !== null && w > p.qtyHundredths
}

// Parts linked to what is being marked done start ticked with 1 (when there is some on the shelf).
watch(linked, (list) => {
  for (const p of list) {
    if (!use.value[p.id]) use.value[p.id] = { on: p.qtyHundredths > 0, qtyText: '1', anyway: false, clientId: crypto.randomUUID() }
  }
})
function addPart(p: ShelfPart) {
  use.value[p.id] = { on: true, qtyText: '1', anyway: false, clientId: crypto.randomUUID() }
  addedIds.value.push(p.id)
  addQuery.value = ''
  addOpen.value = false
}

watch(
  open,
  async (isOpen) => {
    if (!isOpen) return
    at.value = todayLocal()
    hoursText.value = hasHours.value && props.current?.hoursTenths != null ? String(props.current.hoursTenths / 10) : ''
    kmText.value = hasKm.value && props.current?.km != null ? String(props.current.km) : ''
    by.value = 'diy'
    garageName.value = ''
    picked.value = []
    costText.value = ''
    notesText.value = ''
    error.value = ''
    use.value = {}
    addedIds.value = []
    addQuery.value = ''
    addOpen.value = false
    shelf.value = []
    const mine = ++session
    shelfLoading.value = true
    get<ShelfPart[]>('/api/parts')
      .then((list) => { if (mine === session && open.value) shelf.value = list.filter((p) => !p.pending && !p.id.startsWith('pending-')) })
      .catch(() => {})
      .finally(() => { if (mine === session) shelfLoading.value = false })
    try {
      categories.value = await get<Category[]>('/api/categories')
      categoryId.value = (categories.value.find((c) => c.kind === 'maintenance') ?? categories.value[0])?.id ?? ''
    } catch {
      categories.value = []
    }
  },
  { immediate: true },
)

async function save() {
  if (busy.value || !props.itemId) return
  error.value = ''
  const h = hoursText.value.trim() ? parseDecimal(hoursText.value) : null
  const k = kmText.value.trim() ? parseDecimal(kmText.value) : null
  if ((hoursText.value.trim() && (h === null || h < 0)) || (kmText.value.trim() && (k === null || k < 0))) {
    return void (error.value = t.value.logRide.asNumbers(hasHours.value && hasKm.value ? 'meters' : hasHours.value ? 'hours' : 'km'))
  }
  const cents = costText.value.trim() ? parseCents(costText.value) : null
  if (costText.value.trim() && cents === null) return void (error.value = t.value.markDone.costAmount)
  if (cents !== null && !categoryId.value) return void (error.value = t.value.markDone.costCategory)
  const lines = []
  for (const p of shownParts.value) {
    const u = use.value[p.id]
    if (!u?.on) continue
    const w = wanted(p)
    if (w === null) return void (error.value = t.value.markDone.howMuch(p.name))
    lines.push({ clientId: u.clientId, partId: p.id, qtyHundredths: w, partName: p.name })
  }
  const partsUsed = mergeUseLines(lines)
  const counts = Object.fromEntries(shownParts.value.map((p) => [p.id, p.qtyHundredths]))
  for (const id of overdrawn(partsUsed, counts)) {
    const p = shownParts.value.find((x) => x.id === id)!
    if (!use.value[id]?.anyway) return void (error.value = t.value.markDone.onlyOnShelf(fmtQty(Math.max(p.qtyHundredths, 0), p.unit), p.name))
  }
  busy.value = true
  try {
    const detail = await mutate<Detail>('/api/services', {
      clientId,
      bikeId: props.bikeId,
      at: at.value,
      ...(h !== null ? { hoursTenths: Math.round(h * 10) } : {}),
      ...(k !== null ? { km: Math.round(k) } : {}),
      by: by.value,
      ...(by.value === 'garage' && garageName.value.trim() ? { garageName: garageName.value.trim() } : {}),
      itemIds: [props.itemId, ...picked.value],
      ...(notesText.value.trim() ? { notes: notesText.value.trim() } : {}),
      ...(partsUsed.length ? { partsUsed } : {}),
      ...(cents !== null ? { expenses: [{ amountCents: cents, categoryId: categoryId.value, description: itemName.value }] } : {}),
    }, { queue: true })
    clientId = crypto.randomUUID()
    open.value = false
    emit('saved', detail)
  } catch (e) {
    error.value = errorMessage(e, t.value.markDone.failed)
  } finally {
    busy.value = false
  }
}

const field = 'mt-1 block w-full rounded-xl bg-bg px-3 py-3 text-base normal-case text-white outline-none focus:ring-2 focus:ring-accent'
</script>

<template>
  <Sheet v-model:open="open" :title="t.markDone.title(itemName)" testid="mark-done-sheet">
    <form @submit.prevent="save" @input="error = ''" @change="error = ''">
      <label class="block text-[11px] uppercase tracking-wider text-muted">
        {{ t.common.date }}
        <input v-model="at" type="date" :max="todayLocal()" required data-testid="md-date" :class="field">
      </label>
      <div class="mt-3 flex gap-2.5">
        <label v-if="hasHours" class="flex-1 text-[11px] uppercase tracking-wider text-muted">
          {{ t.common.hours }}
          <input v-model="hoursText" inputmode="decimal" autocomplete="off" data-testid="md-hours" :class="field">
        </label>
        <label v-if="hasKm" class="flex-1 text-[11px] uppercase tracking-wider text-muted">
          {{ t.common.km }}
          <input v-model="kmText" inputmode="decimal" autocomplete="off" data-testid="md-km" :class="field">
        </label>
      </div>
      <div class="mt-3 flex gap-1.5" role="radiogroup" :aria-label="t.markDone.doneBy">
        <button
          v-for="o in [{ k: 'diy', l: t.common.diy }, { k: 'garage', l: t.markDone.garage }] as const"
          :key="o.k"
          type="button"
          role="radio"
          :aria-checked="by === o.k"
          :data-testid="`md-by-${o.k}`"
          class="flex-1 rounded-full px-1 py-2 text-sm font-semibold"
          :class="by === o.k ? 'bg-accent text-on-accent' : 'bg-bg text-muted'"
          @click="by = o.k"
        >
          {{ o.l }}
        </button>
      </div>
      <label v-if="by === 'garage'" class="mt-3 block text-[11px] uppercase tracking-wider text-muted">
        {{ t.markDone.garageName }}
        <input v-model="garageName" autocomplete="off" maxlength="80" data-testid="md-garage" :class="field">
      </label>
      <fieldset v-if="others.length" class="mt-3">
        <legend class="text-[11px] uppercase tracking-wider text-muted">{{ t.markDone.alsoDone }}</legend>
        <div class="mt-1 max-h-44 space-y-1 overflow-y-auto rounded-xl bg-bg p-2">
          <label v-for="i in others" :key="i.id" class="flex min-h-10 items-center gap-2.5 py-1.5 text-sm text-white">
            <input v-model="picked" type="checkbox" :value="i.id" class="h-5 w-5 shrink-0 accent-accent">
            {{ itemLabel(i.name) }}
          </label>
        </div>
      </fieldset>
      <fieldset v-if="shownParts.length || shelf.length" class="mt-3" data-testid="parts-used">
        <legend class="text-[11px] uppercase tracking-wider text-muted">{{ t.markDone.partsUsed }}</legend>
        <ul v-if="shownParts.length" class="mt-1 space-y-1 rounded-xl bg-bg p-2">
          <li v-for="p in shownParts" :key="p.id" class="text-sm text-white" data-testid="parts-used-row">
            <div class="flex items-center gap-2">
              <label class="flex min-h-11 min-w-0 flex-1 items-center gap-2">
                <input v-model="use[p.id]!.on" type="checkbox" class="h-5 w-5 shrink-0 accent-accent" :aria-label="t.markDone.used(p.name)" data-testid="parts-used-check" @change="use[p.id]!.anyway = false">
                <span class="min-w-0">
                  <span class="block truncate">{{ p.name }}</span>
                  <span class="block text-xs" :class="p.qtyHundredths <= 0 ? 'text-danger-text' : 'text-muted'">{{ t.markDone.onShelf(fmtQty(p.qtyHundredths, p.unit)) }}</span>
                </span>
              </label>
              <input
                v-if="use[p.id]?.on"
                v-model="use[p.id]!.qtyText"
                inputmode="decimal"
                autocomplete="off"
                :aria-label="t.markDone.quantity(p.name)"
                data-testid="parts-used-qty"
                class="min-h-11 w-16 shrink-0 rounded-lg bg-surface px-2 text-center text-base text-white outline-none focus:ring-2 focus:ring-accent"
                @input="use[p.id]!.anyway = false"
              >
              <span v-if="use[p.id]?.on && p.unit !== 'pcs'" class="shrink-0 text-xs text-muted">{{ p.unit }}</span>
            </div>
            <div v-if="short(p)" class="flex items-center justify-between gap-2 pb-1 pl-7 text-xs text-warn-text" data-testid="parts-short">
              <span>{{ t.markDone.moreThanShelf }}</span>
              <button
                v-if="!use[p.id]!.anyway"
                type="button"
                class="min-h-11 shrink-0 px-2 font-bold text-accent-text"
                data-testid="parts-use-anyway"
                @click="use[p.id]!.anyway = true"
              >
                {{ t.markDone.useAnyway }}
              </button>
              <span v-else class="shrink-0 px-2 text-muted">{{ t.markDone.belowZero }}</span>
            </div>
          </li>
        </ul>
        <button v-if="!addOpen && shelf.length" type="button" class="mt-1 min-h-11 text-sm font-semibold text-accent-text" data-testid="parts-add-open" @click="addOpen = true">{{ t.markDone.addFromShelf }}</button>
        <div v-if="addOpen">
          <input v-model="addQuery" type="search" autocomplete="off" :placeholder="t.markDone.searchShelf" :aria-label="t.markDone.searchShelf" data-testid="parts-add" :class="field">
          <ul class="mt-1 space-y-1">
            <li v-for="p in addOptions" :key="p.id">
              <button type="button" class="flex min-h-11 w-full items-center justify-between gap-2 rounded-xl bg-bg px-3 text-left text-sm text-white" data-testid="parts-add-option" @click="addPart(p)">
                <span class="truncate">{{ p.name }}</span>
                <span class="shrink-0 text-xs text-muted">{{ fmtQty(p.qtyHundredths, p.unit) }}</span>
              </button>
            </li>
          </ul>
        </div>
      </fieldset>
      <div class="mt-3 flex gap-2.5">
        <label class="flex-1 text-[11px] uppercase tracking-wider text-muted">
          {{ t.markDone.cost }}
          <input v-model="costText" inputmode="decimal" autocomplete="off" :placeholder="t.markDone.costPh" data-testid="md-cost" :class="field">
        </label>
        <label class="flex-1 text-[11px] uppercase tracking-wider text-muted">
          {{ t.markDone.category }}
          <select v-model="categoryId" data-testid="md-category" :class="field">
            <option v-for="c in categories" :key="c.id" :value="c.id">{{ categoryLabel(c.name) }}</option>
          </select>
        </label>
      </div>
      <label class="mt-3 block text-[11px] uppercase tracking-wider text-muted">
        {{ t.markDone.notes }}
        <input v-model="notesText" maxlength="500" autocomplete="off" :placeholder="t.markDone.notesPh" data-testid="md-notes" :class="field">
      </label>
      <p v-if="error" role="alert" class="mt-3 text-sm text-danger-text" data-testid="md-error">{{ error }}</p>
      <button type="submit" :disabled="busy || shelfLoading" class="mt-4 w-full rounded-xl bg-accent py-3.5 text-base font-bold text-on-accent disabled:opacity-60" data-testid="md-save">{{ t.common.save }}</button>
    </form>
  </Sheet>
</template>
