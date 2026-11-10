<script setup lang="ts">
import { parseCents, todayLocal } from '~/lib/parse-number'
import { errorMessage } from '~/offline/outbox'
import { categoryLabel } from '~/lib/server-text'
const { t } = useI18n()

type Category = { id: string; name: string; kind: string }

const props = defineProps<{ bikes: { id: string; name: string }[]; defaultBikeId?: string | null }>()
const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ saved: [] }>()

const { get, mutate } = useApi()
const toast = useToast()

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
  if (cents === null) return void (error.value = t.value.expense.needAmount)
  if (!categoryId.value) return void (error.value = t.value.expense.needCategory)
  busy.value = true
  try {
    const res = await mutate('/api/expenses', {
      clientId,
      at: at.value,
      amountCents: cents,
      categoryId: categoryId.value,
      description: description.value.trim(),
      ...(bikeId.value ? { bikeId: bikeId.value } : {}),
    }, { queue: true })
    clientId = crypto.randomUUID()
    open.value = false
    toast.show(isQueued(res) ? t.value.expense.savedHere : t.value.expense.saved)
    emit('saved')
  } catch (e) {
    error.value = errorMessage(e, t.value.expense.failed)
  } finally {
    busy.value = false
  }
}

const field = 'mt-1 block w-full rounded-xl bg-bg px-3 py-3 text-base normal-case text-white outline-none focus:ring-2 focus:ring-accent'
</script>

<template>
  <Sheet v-model:open="open" :title="t.expense.title" testid="expense-sheet">
    <form @submit.prevent="save" @input="error = ''" @change="error = ''">
      <div class="flex gap-2.5">
        <label class="flex-1 text-[11px] uppercase tracking-wider text-muted">
          {{ t.expense.amount }}
          <input v-model="amountText" inputmode="decimal" autocomplete="off" :placeholder="t.expense.amountPh" data-testid="ex-amount" :class="field">
        </label>
        <label class="flex-1 text-[11px] uppercase tracking-wider text-muted">
          {{ t.common.date }}
          <input v-model="at" type="date" :max="todayLocal()" required data-testid="ex-date" :class="field">
        </label>
      </div>
      <label class="mt-3 block text-[11px] uppercase tracking-wider text-muted">
        {{ t.expense.category }}
        <select v-model="categoryId" data-testid="ex-category" :class="field">
          <option v-for="c in categories" :key="c.id" :value="c.id">{{ categoryLabel(c.name) }}</option>
        </select>
      </label>
      <label class="mt-3 block text-[11px] uppercase tracking-wider text-muted">
        {{ t.expense.bikeOptional }}
        <select v-model="bikeId" data-testid="ex-bike" :class="field">
          <option value="">{{ t.common.noBike }}</option>
          <option v-for="b in props.bikes" :key="b.id" :value="b.id">{{ b.name }}</option>
        </select>
      </label>
      <label class="mt-3 block text-[11px] uppercase tracking-wider text-muted">
        {{ t.expense.description }}
        <input v-model="description" autocomplete="off" maxlength="200" :placeholder="t.expense.descriptionPh" data-testid="ex-description" :class="field">
      </label>
      <p v-if="error" role="alert" class="mt-3 text-sm text-danger-text" data-testid="ex-error">{{ error }}</p>
      <button type="submit" :disabled="busy" class="mt-4 w-full rounded-xl bg-accent py-3.5 text-base font-bold text-on-accent disabled:opacity-60" data-testid="ex-save">{{ t.common.save }}</button>
    </form>
  </Sheet>
</template>
