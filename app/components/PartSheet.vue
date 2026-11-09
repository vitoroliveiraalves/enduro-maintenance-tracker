<script setup lang="ts">
import { errorMessage } from '~/offline/outbox'
import { parseDecimal } from '~/lib/parse-number'
import type { ShelfPart } from '~/lib/shelf'

type History = { id: string; kind: string; qtyHundredths: number; at: string; note: string | null; unitCents: number | null; garageName: string | null }
type BikeItems = { id: string; name: string }

const props = defineProps<{ part: ShelfPart | null; bikes: Array<{ id: string; name: string }> }>()
const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ changed: [] }>()
const { get, mutate } = useApi()
const { qty: fmtQty, money, date } = useFormatters()
const toast = useToast()

const name = ref('')
const unit = ref('pcs')
const startText = ref('')
const minText = ref('')
const notes = ref('')
const bikeId = ref('')
const itemIds = ref<string[]>([])
const count = ref(0)
const history = ref<History[]>([])
const choices = ref<Array<{ id: string; name: string; bike: string }>>([])
const error = ref('')
const busy = ref(false)
const confirmDelete = ref(false)

const minHundredths = computed(() => props.part?.minHundredths ?? null)
const isNew = computed(() => !props.part)
const hundredths = (text: string) => {
  const n = parseDecimal(text.trim())
  return n === null ? null : Math.round(n * 100)
}

async function loadChoices() {
  const ids = bikeId.value ? [bikeId.value] : props.bikes.map((b) => b.id)
  const out: typeof choices.value = []
  for (const id of ids) {
    try {
      const d = await get<{ bike: { name: string }; items: BikeItems[] }>(`/api/bikes/${id}`)
      for (const it of d.items) out.push({ id: it.id, name: it.name, bike: d.bike.name })
    } catch {
      // offline and never opened: that bike's items just aren't offered
    }
  }
  choices.value = out
}
// A part only links to items of its own bike: drop links the new choice doesn't offer.
watch(bikeId, async () => {
  if (!open.value) return
  await loadChoices()
  if (bikeId.value && choices.value.length) itemIds.value = itemIds.value.filter((id) => choices.value.some((c) => c.id === id))
})

watch(open, async (v) => {
  if (!v) return
  const p = props.part
  error.value = ''
  confirmDelete.value = false
  history.value = []
  name.value = p?.name ?? ''
  unit.value = p?.unit ?? 'pcs'
  startText.value = ''
  minText.value = p?.minHundredths != null ? String(p.minHundredths / 100) : ''
  notes.value = p?.notes ?? ''
  bikeId.value = p?.bikeId ?? ''
  itemIds.value = [...(p?.itemIds ?? [])]
  count.value = p?.qtyHundredths ?? 0
  void loadChoices()
  void loadHistory()
})

async function loadHistory() {
  if (!props.part) return
  try {
    history.value = (await get<{ history: History[] }>(`/api/parts/${props.part.id}`)).history
  } catch {
    // no copy offline: the history just stays as it was
  }
}

const multiBike = computed(() => !bikeId.value && new Set(choices.value.map((c) => c.bike)).size > 1)
function toggle(id: string) {
  itemIds.value = itemIds.value.includes(id) ? itemIds.value.filter((x) => x !== id) : [...itemIds.value, id]
}

async function move(delta: number) {
  const p = props.part
  if (!p || busy.value) return
  busy.value = true
  error.value = ''
  try {
    const res = await mutate<ShelfPart | { queued: true }>(`/api/parts/${p.id}/movements`, { qtyHundredths: delta }, { queue: true })
    count.value = isQueued(res) ? count.value + delta : (res as ShelfPart).qtyHundredths
    emit('changed')
    if (!isQueued(res)) void loadHistory()
  } catch (e) {
    error.value = errorMessage(e, "Couldn't change the count. Try again.")
  } finally {
    busy.value = false
  }
}

async function save() {
  if (busy.value) return
  error.value = ''
  const n = name.value.trim()
  const u = unit.value.trim()
  if (!n) return void (error.value = 'Give the part a name.')
  if (!u) return void (error.value = 'Give the unit (pcs, L, m…).')
  let min: number | null = null
  if (minText.value.trim()) {
    min = hundredths(minText.value)
    if (min === null || min < 0) return void (error.value = 'Keep at least: type a number, like 2 or 1,5.')
  }
  let start = 0
  if (isNew.value && startText.value.trim()) {
    const s = hundredths(startText.value)
    if (s === null || s < 0) return void (error.value = 'How many: type a number, like 2 or 1,5.')
    start = s
  }
  busy.value = true
  try {
    const common = { name: n, unit: u, minHundredths: min, notes: notes.value.trim() || null, bikeId: bikeId.value || null, itemIds: itemIds.value }
    const res = props.part
      ? await mutate(`/api/parts/${props.part.id}`, common, { method: 'PATCH', queue: true })
      : await mutate('/api/parts', { ...common, ...(start > 0 ? { qtyHundredths: start, startClientId: crypto.randomUUID() } : {}) }, { queue: true })
    open.value = false
    toast.show(isQueued(res) ? `${n} saved on this phone · syncs when online` : `${n} saved`)
    emit('changed')
  } catch (e) {
    error.value = errorMessage(e, "Couldn't save the part. Try again.")
  } finally {
    busy.value = false
  }
}

async function remove() {
  if (!props.part || busy.value) return
  busy.value = true
  try {
    await mutate(`/api/parts/${props.part.id}`, {}, { method: 'DELETE' })
    open.value = false
    toast.show(`${props.part.name} deleted`)
    emit('changed')
  } catch (e) {
    error.value = errorMessage(e, "Couldn't delete the part. Try again.")
  } finally {
    busy.value = false
    confirmDelete.value = false
  }
}

const KIND: Record<string, string> = { adjust: 'Adjusted', bought: 'Bought', used: 'Used', service: 'Used in a service' }
const kindLabel = (h: History) => (h.kind === 'used' || h.kind === 'service' ? (h.garageName ? `Used · ${h.garageName}` : 'Used') : (KIND[h.kind] ?? h.kind))
const field = 'mt-1 block w-full rounded-xl bg-bg px-3 py-3 text-base normal-case text-white outline-none focus:ring-2 focus:ring-accent'
const lbl = 'block text-[11px] uppercase tracking-wider text-muted'
</script>

<template>
  <Sheet v-model:open="open" :title="isNew ? 'Add part' : 'Part'" testid="part-sheet">
    <form @submit.prevent="save" @input="error = ''">
      <label :class="lbl">
        Name
        <input v-model="name" maxlength="80" autocomplete="off" data-testid="part-name" :class="field">
      </label>

      <div v-if="!isNew" class="mt-3 flex items-center justify-between rounded-xl bg-bg p-1.5" data-testid="part-counter">
        <button type="button" class="size-12 rounded-lg bg-surface text-2xl font-bold text-white disabled:opacity-50" aria-label="One less" :disabled="busy" data-testid="part-minus" @click="move(-100)">−</button>
        <div class="text-center">
          <div class="text-2xl font-bold" :class="count <= 0 ? 'text-muted' : minHundredths !== null && count < minHundredths ? 'text-danger-text' : 'text-white'" data-testid="part-count">{{ fmtQty(count, unit) }}</div>
          <div class="text-[11px] uppercase tracking-wider text-muted">on the shelf</div>
        </div>
        <button type="button" class="size-12 rounded-lg bg-surface text-2xl font-bold text-white disabled:opacity-50" aria-label="One more" :disabled="busy" data-testid="part-plus" @click="move(100)">+</button>
      </div>

      <div class="mt-3 grid grid-cols-2 gap-2.5">
        <label v-if="isNew" :class="lbl">
          How many
          <input v-model="startText" inputmode="decimal" autocomplete="off" data-testid="part-start" :class="field">
        </label>
        <label :class="lbl">
          Unit
          <input v-model="unit" maxlength="12" autocomplete="off" data-testid="part-unit" :class="field">
        </label>
        <label :class="lbl">
          Keep at least
          <input v-model="minText" inputmode="decimal" autocomplete="off" placeholder="optional" data-testid="part-min" :class="field">
        </label>
      </div>

      <label class="mt-3 block" :class="lbl">
        Bike
        <select v-model="bikeId" data-testid="part-bike" :class="field">
          <option value="">Any bike</option>
          <option v-for="b in props.bikes" :key="b.id" :value="b.id">{{ b.name }}</option>
        </select>
      </label>

      <div v-if="choices.length" class="mt-3">
        <div :class="lbl">Fits these items</div>
        <div class="mt-1.5 flex flex-wrap gap-1.5" data-testid="part-items">
          <button
            v-for="c in choices"
            :key="c.id"
            type="button"
            class="min-h-11 rounded-full px-3 text-sm"
            :class="itemIds.includes(c.id) ? 'bg-accent/20 text-accent-text' : 'border border-white/15 text-muted'"
            :aria-pressed="itemIds.includes(c.id)"
            data-testid="part-item"
            @click="toggle(c.id)"
          >
            {{ c.name }}<template v-if="multiBike"> · {{ c.bike }}</template>
          </button>
        </div>
      </div>

      <label class="mt-3 block" :class="lbl">
        Notes
        <textarea v-model="notes" rows="2" maxlength="500" data-testid="part-notes" :class="field" />
      </label>

      <p v-if="error" role="alert" class="mt-3 text-sm text-danger-text" data-testid="part-error">{{ error }}</p>
      <button type="submit" :disabled="busy" class="mt-4 w-full rounded-xl bg-accent py-3.5 text-base font-bold text-on-accent disabled:opacity-60" data-testid="part-save">Save</button>
    </form>

    <section v-if="!isNew" class="mt-5">
      <h3 class="text-[11px] uppercase tracking-wider text-muted">History</h3>
      <ul v-if="history.length" class="mt-1.5 divide-y divide-white/5" data-testid="part-history">
        <li v-for="h in history" :key="h.id" class="flex min-h-11 items-center justify-between gap-3 py-2 text-sm">
          <span class="min-w-0">
            <span class="block truncate text-white">{{ kindLabel(h) }}<template v-if="h.unitCents !== null"> · {{ money(h.unitCents) }} each</template></span>
            <span class="block truncate text-xs text-muted">{{ date(h.at) }}<template v-if="h.note"> · {{ h.note }}</template></span>
          </span>
          <span class="shrink-0 font-semibold" :class="h.qtyHundredths < 0 ? 'text-muted' : 'text-ok-text'">{{ h.qtyHundredths > 0 ? '+' : '' }}{{ fmtQty(h.qtyHundredths, unit) }}</span>
        </li>
      </ul>
      <p v-else class="mt-1.5 text-sm text-muted">No movements yet.</p>

      <div class="mt-5">
        <button v-if="!confirmDelete" type="button" class="min-h-11 w-full rounded-xl border border-danger/40 text-sm font-semibold text-danger-text" data-testid="part-delete" @click="confirmDelete = true">Delete part</button>
        <div v-else class="rounded-xl bg-bg p-3" data-testid="part-delete-confirm">
          <p class="text-sm text-white">Delete {{ props.part?.name }}? Its history stays in your records.</p>
          <div class="mt-2.5 grid grid-cols-2 gap-2">
            <button type="button" class="min-h-11 rounded-lg border border-white/15 text-sm" @click="confirmDelete = false">Keep it</button>
            <button type="button" :disabled="busy" class="min-h-11 rounded-lg bg-danger text-sm font-bold text-on-danger disabled:opacity-60" data-testid="part-delete-yes" @click="remove">Delete</button>
          </div>
        </div>
      </div>
    </section>
  </Sheet>
</template>
