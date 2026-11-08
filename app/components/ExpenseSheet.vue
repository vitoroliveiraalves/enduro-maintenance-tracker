<script setup lang="ts">
import { parseCents, todayLocal } from '~/lib/parse-number'

type Category = { id: string; name: string; kind: string }

const props = defineProps<{ bikes: { id: string; name: string }[]; defaultBikeId?: string | null }>()
const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ saved: [] }>()

const { get, mutate } = useApi()

const at = ref(todayLocal())
const amountText = ref('')
const categoryId = ref('')
const bikeId = ref('')
const description = ref('')
const categories = ref<Category[]>([])
const error = ref('')
const busy = ref(false)
let clientId = crypto.randomUUID()

watch(
  open,
  async (isOpen) => {
    if (!isOpen) return
    at.value = todayLocal()
    amountText.value = ''
    description.value = ''
    bikeId.value = props.defaultBikeId ?? ''
    error.value = ''
    try {
      categories.value = await get<Category[]>('/api/categories')
      categoryId.value = (categories.value.find((c) => c.kind === 'fuel') ?? categories.value[0])?.id ?? ''
    } catch {
      categories.value = []
    }
  },
  { immediate: true },
)

async function save() {
  if (busy.value) return
  error.value = ''
  const cents = parseCents(amountText.value)
  if (cents === null) return void (error.value = 'Enter the amount, like 41,60.')
  if (!categoryId.value) return void (error.value = 'Pick a category.')
  busy.value = true
  try {
    await mutate('/api/expenses', {
      clientId,
      at: at.value,
      amountCents: cents,
      categoryId: categoryId.value,
      description: description.value.trim(),
      ...(bikeId.value ? { bikeId: bikeId.value } : {}),
    })
    clientId = crypto.randomUUID()
    open.value = false
    emit('saved')
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
  <Sheet v-model:open="open" title="Add expense" testid="expense-sheet">
    <form @submit.prevent="save">
      <div class="flex gap-2.5">
        <label class="flex-1 text-[11px] uppercase tracking-wider text-muted">
          Amount (€)
          <input v-model="amountText" inputmode="decimal" autocomplete="off" placeholder="41,60" data-testid="ex-amount" :class="field">
        </label>
        <label class="flex-1 text-[11px] uppercase tracking-wider text-muted">
          Date
          <input v-model="at" type="date" :max="todayLocal()" required data-testid="ex-date" :class="field">
        </label>
      </div>
      <label class="mt-3 block text-[11px] uppercase tracking-wider text-muted">
        Category
        <select v-model="categoryId" data-testid="ex-category" :class="field">
          <option v-for="c in categories" :key="c.id" :value="c.id">{{ c.name }}</option>
        </select>
      </label>
      <label class="mt-3 block text-[11px] uppercase tracking-wider text-muted">
        Bike (optional)
        <select v-model="bikeId" data-testid="ex-bike" :class="field">
          <option value="">No bike</option>
          <option v-for="b in props.bikes" :key="b.id" :value="b.id">{{ b.name }}</option>
        </select>
      </label>
      <label class="mt-3 block text-[11px] uppercase tracking-wider text-muted">
        Description
        <input v-model="description" autocomplete="off" maxlength="200" placeholder="Fuel at the track" data-testid="ex-description" :class="field">
      </label>
      <p v-if="error" role="alert" class="mt-3 text-sm text-danger" data-testid="ex-error">{{ error }}</p>
      <button type="submit" :disabled="busy" class="mt-4 w-full rounded-xl bg-accent py-3.5 text-base font-bold text-black disabled:opacity-60" data-testid="ex-save">Save</button>
    </form>
  </Sheet>
</template>
