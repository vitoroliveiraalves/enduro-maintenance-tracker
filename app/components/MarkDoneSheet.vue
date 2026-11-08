<script setup lang="ts">
import { parseCents, parseDecimal, todayLocal } from '~/lib/parse-number'
import type { ItemRowJson } from '../../server/domain/item-row'

type Detail = Record<string, unknown>
type Category = { id: string; name: string; kind: string }

const props = defineProps<{
  bikeId: string
  items: ItemRowJson[]
  current: { hoursTenths: number; km: number } | null
  itemId: string | null
}>()
const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ saved: [detail: Detail] }>()

const { get, mutate } = useApi()

const at = ref(todayLocal())
const hoursText = ref('')
const kmText = ref('')
const by = ref<'diy' | 'garage'>('diy')
const garageName = ref('')
const picked = ref<string[]>([])
const costText = ref('')
const categoryId = ref('')
const categories = ref<Category[]>([])
const error = ref('')
const busy = ref(false)
// One id per "mark done" intent: a double tap or a retry can never create two services.
let clientId = crypto.randomUUID()

const itemName = computed(() => props.items.find((i) => i.id === props.itemId)?.name ?? 'item')
const others = computed(() => props.items.filter((i) => i.id !== props.itemId))

watch(
  open,
  async (isOpen) => {
    if (!isOpen) return
    at.value = todayLocal()
    hoursText.value = props.current ? String(props.current.hoursTenths / 10) : ''
    kmText.value = props.current ? String(props.current.km) : ''
    by.value = 'diy'
    garageName.value = ''
    picked.value = []
    costText.value = ''
    error.value = ''
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
    return void (error.value = 'Enter hours and km as numbers.')
  }
  const cents = costText.value.trim() ? parseCents(costText.value) : null
  if (costText.value.trim() && cents === null) return void (error.value = 'Enter the cost as an amount, like 24,90.')
  if (cents !== null && !categoryId.value) return void (error.value = 'Pick a category for the cost.')
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
      ...(cents !== null ? { expenses: [{ amountCents: cents, categoryId: categoryId.value, description: itemName.value }] } : {}),
    })
    clientId = crypto.randomUUID()
    open.value = false
    emit('saved', detail)
  } catch (e) {
    const { statusMessage, data } = e as { statusMessage?: string; data?: { statusMessage?: string } }
    error.value = data?.statusMessage ?? statusMessage ?? 'Could not save. Try again.'
  } finally {
    busy.value = false
  }
}

const field = 'mt-1 block w-full rounded-xl bg-bg px-3 py-3 text-base normal-case text-white outline-none focus:ring-2 focus:ring-accent'
</script>

<template>
  <Sheet v-model:open="open" :title="`Mark done: ${itemName}`" testid="mark-done-sheet">
    <form @submit.prevent="save">
      <label class="block text-[11px] uppercase tracking-wider text-muted">
        Date
        <input v-model="at" type="date" :max="todayLocal()" required data-testid="md-date" :class="field">
      </label>
      <div class="mt-3 flex gap-2.5">
        <label class="flex-1 text-[11px] uppercase tracking-wider text-muted">
          Hours
          <input v-model="hoursText" inputmode="decimal" autocomplete="off" data-testid="md-hours" :class="field">
        </label>
        <label class="flex-1 text-[11px] uppercase tracking-wider text-muted">
          Km
          <input v-model="kmText" inputmode="decimal" autocomplete="off" data-testid="md-km" :class="field">
        </label>
      </div>
      <div class="mt-3 flex gap-1.5" role="radiogroup" aria-label="Done by">
        <button
          v-for="o in [{ k: 'diy', l: 'DIY' }, { k: 'garage', l: 'Garage' }] as const"
          :key="o.k"
          type="button"
          role="radio"
          :aria-checked="by === o.k"
          :data-testid="`md-by-${o.k}`"
          class="flex-1 rounded-full px-1 py-2 text-sm font-semibold"
          :class="by === o.k ? 'bg-accent text-black' : 'bg-bg text-muted'"
          @click="by = o.k"
        >
          {{ o.l }}
        </button>
      </div>
      <label v-if="by === 'garage'" class="mt-3 block text-[11px] uppercase tracking-wider text-muted">
        Garage name (optional)
        <input v-model="garageName" autocomplete="off" maxlength="80" data-testid="md-garage" :class="field">
      </label>
      <fieldset v-if="others.length" class="mt-3">
        <legend class="text-[11px] uppercase tracking-wider text-muted">Also done in the same visit</legend>
        <div class="mt-1 max-h-36 space-y-1 overflow-y-auto rounded-xl bg-bg p-2">
          <label v-for="i in others" :key="i.id" class="flex items-center gap-2 py-1 text-sm text-white">
            <input v-model="picked" type="checkbox" :value="i.id" class="h-4 w-4 accent-accent">
            {{ i.name }}
          </label>
        </div>
      </fieldset>
      <div class="mt-3 flex gap-2.5">
        <label class="flex-1 text-[11px] uppercase tracking-wider text-muted">
          Cost (optional)
          <input v-model="costText" inputmode="decimal" autocomplete="off" placeholder="24,90" data-testid="md-cost" :class="field">
        </label>
        <label class="flex-1 text-[11px] uppercase tracking-wider text-muted">
          Category
          <select v-model="categoryId" data-testid="md-category" :class="field">
            <option v-for="c in categories" :key="c.id" :value="c.id">{{ c.name }}</option>
          </select>
        </label>
      </div>
      <p v-if="error" role="alert" class="mt-3 text-sm text-danger" data-testid="md-error">{{ error }}</p>
      <button type="submit" :disabled="busy" class="mt-4 w-full rounded-xl bg-accent py-3.5 text-base font-bold text-black disabled:opacity-60" data-testid="md-save">Save</button>
    </form>
  </Sheet>
</template>
