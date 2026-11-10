<script setup lang="ts">
import { errorMessage } from '~/offline/outbox'
import { todayLocal, parseCents } from '~/lib/parse-number'
import { formatDate, formatMoney } from '~/lib/format'
import type { ReminderRow } from '../../server/utils/reminders'
const { t } = useI18n()

type PaymentExpense = {
  id: string
  bikeId: string | null
  at: string
  amountCents: number
  categoryKind: string
  description: string
}

const props = defineProps<{
  bikes: Array<{ id: string; name: string; vehicleType?: 'motorcycle' | 'car' }>
  defaultBikeId?: string
  initialReminder?: (Partial<ReminderRow> & { id: string; title: string; dueOn: string; repeatYearly: boolean }) | null
}>()
const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ saved: [] }>()
const { get, mutate } = useApi()
const toast = useToast()

const title = ref('')
const dueOn = ref('')
const bikeId = ref('')
const amount = ref('')
const provider = ref('')
const policyNumber = ref('')
const repeatYearly = ref(true)
const editingId = ref<string | null>(null)
const activeReminders = ref<ReminderRow[]>([])
const expenses = ref<PaymentExpense[]>([])
const confirmRemove = ref(false)
const error = ref('')
const busy = ref(false)

const currentTarget = computed(() => {
  const id = editingId.value || props.initialReminder?.id
  if (!id) return null
  return activeReminders.value.find((r) => r.id === id) ?? props.initialReminder ?? null
})

const paymentHistory = computed(() => {
  const nt = title.value.trim().toLowerCase()
  return expenses.value.filter((e) => {
    if (e.categoryKind !== 'insurance') return false
    if (bikeId.value && e.bikeId && e.bikeId !== bikeId.value) return false
    if (!nt) return true
    const desc = e.description.toLowerCase()
    if (nt === 'insurance' || nt === 'seguro') return desc.includes('insurance') || desc.includes('seguro')
    if (nt === 'iuc') return desc.includes('iuc')
    if (nt === 'inspection' || nt === 'inspeção' || nt === 'inspecao' || nt === 'ipo') {
      return desc.includes('inspection') || desc.includes('inspeção') || desc.includes('inspecao') || desc.includes('ipo')
    }
    return desc.includes(nt)
  }).slice(0, 5)
})

const selectedBike = computed(() => props.bikes.find((b) => b.id === bikeId.value))
const isMotorcycle = computed(() => selectedBike.value?.vehicleType === 'motorcycle')

// Preset titles in the rider's language; Inspection (IPO) is hidden for motorcycles.
const ALL_PRESETS = [
  ['Insurance', 'insurance'],
  ['IUC', 'iuc'],
  ['Inspection', 'inspection'],
  ['Licence', 'licence'],
] as const

const presets = computed(() => {
  return ALL_PRESETS
    .filter(([id]) => !(isMotorcycle.value && id === 'Inspection'))
    .map(([id, k]) => ({ id, label: t.value.reminderSheet.presets[k as keyof typeof t.value.reminderSheet.presets] }))
})

// "All bikes" until the rider picks; a lone bike is the default, even when
// the bike list arrives after the sheet opened (slow network).
const bikeTouched = ref(false)
const defaultBike = () => props.defaultBikeId || (props.bikes.length === 1 ? props.bikes[0]!.id : '')

async function loadActiveReminders() {
  try {
    activeReminders.value = await get<ReminderRow[]>('/api/reminders')
  } catch {
    // offline or error: keep current
  }
  try {
    expenses.value = await get<PaymentExpense[]>('/api/expenses')
  } catch {
    // offline or error
  }
}

function normPresetKey(presetId: string): string {
  return presetId.toLowerCase()
}

function findExistingForVehicle(presetId: string) {
  const norm = normPresetKey(presetId)
  const targetBike = bikeId.value || null
  return activeReminders.value.find((r) => {
    const sameBike = (targetBike && r.bikeId === targetBike) || (!targetBike && !r.bikeId)
    if (!sameBike) return false
    const nt = r.title.trim().toLowerCase()
    if (norm === 'insurance') return nt === 'insurance' || nt === 'seguro'
    if (norm === 'iuc') return nt === 'iuc'
    if (norm === 'inspection') return nt === 'inspection' || nt === 'inspeção' || nt === 'inspecao' || nt === 'ipo'
    if (norm === 'licence') return nt === 'licence' || nt === 'license' || nt === 'carta de condução' || nt === 'carta de conducao'
    return nt === norm
  })
}

function hasExisting(presetId: string): boolean {
  return !!findExistingForVehicle(presetId)
}

function resetForm() {
  if (props.initialReminder) {
    const r = props.initialReminder
    editingId.value = r.id
    title.value = r.title
    dueOn.value = r.dueOn
    bikeTouched.value = true
    bikeId.value = r.bikeId ?? ''
    amount.value = r.amountCents ? (r.amountCents / 100).toFixed(2).replace('.', ',') : ''
    provider.value = r.provider ?? ''
    policyNumber.value = r.policyNumber ?? ''
    repeatYearly.value = r.repeatYearly
  } else {
    editingId.value = null
    title.value = ''
    dueOn.value = ''
    bikeTouched.value = false
    bikeId.value = defaultBike()
    amount.value = ''
    provider.value = ''
    policyNumber.value = ''
    repeatYearly.value = true
  }
  confirmRemove.value = false
  error.value = ''
}

async function markDone() {
  const target = currentTarget.value
  if (!target || busy.value) return
  busy.value = true
  error.value = ''
  try {
    const res = await mutate<{ dueOn?: string }>(`/api/reminders/${target.id}/done`, { dueOn: target.dueOn }, { queue: true })
    open.value = false
    const nextDate = !isQueued(res) && res?.dueOn && target.repeatYearly ? formatDate(res.dueOn) : ''
    toast.show(nextDate ? t.value.reminderSheet.doneNextToast(title.value.trim() || target.title, nextDate) : t.value.reminderSheet.doneToast(title.value.trim() || target.title))
    emit('saved')
  } catch (e) {
    error.value = errorMessage(e, t.value.reminderSheet.failed, true)
  } finally {
    busy.value = false
  }
}

async function removeReminder() {
  const target = currentTarget.value
  if (!target || busy.value) return
  busy.value = true
  error.value = ''
  try {
    await mutate(`/api/reminders/${target.id}`, {}, { method: 'DELETE', queue: true })
    open.value = false
    toast.show(t.value.reminderSheet.removedToast(title.value.trim() || target.title))
    emit('saved')
  } catch (e) {
    error.value = errorMessage(e, t.value.reminderSheet.failed, true)
  } finally {
    busy.value = false
    confirmRemove.value = false
  }
}

watch(open, (v) => {
  if (!v) return
  resetForm()
  void loadActiveReminders()
})
watch(
  () => props.initialReminder,
  () => {
    if (open.value) resetForm()
  },
)
watch(
  () => props.bikes,
  (b) => {
    if (!bikeTouched.value && !props.initialReminder && b.length === 1 && !bikeId.value) {
      bikeId.value = b[0]!.id
    }
  },
  { deep: true },
)

function pickPreset(presetId: string, label: string) {
  title.value = label
  if (!bikeId.value && !bikeTouched.value) {
    bikeId.value = defaultBike()
  }
  const existing = findExistingForVehicle(presetId)
  if (existing) {
    editingId.value = existing.id
    dueOn.value = existing.dueOn
    repeatYearly.value = existing.repeatYearly
    amount.value = existing.amountCents ? (existing.amountCents / 100).toFixed(2).replace('.', ',') : ''
    provider.value = existing.provider ?? ''
    policyNumber.value = existing.policyNumber ?? ''
  } else if (!props.initialReminder) {
    editingId.value = null
    if (presetId === 'Insurance' || presetId === 'IUC' || presetId === 'Inspection') {
      repeatYearly.value = true
    }
  }
}

async function save() {
  if (busy.value) return
  error.value = ''
  if (!title.value.trim()) return void (error.value = t.value.reminderSheet.needName)
  if (!dueOn.value) return void (error.value = t.value.reminderSheet.needDate)
  const year = Number(dueOn.value.slice(0, 4))
  if (!(year >= 1900 && year <= 2100)) return void (error.value = t.value.reminderSheet.before2101)

  let amountCents: number | null = null
  if (amount.value.trim()) {
    amountCents = parseCents(amount.value)
    if (amountCents === null) return void (error.value = t.value.common.tryAgain)
  }

  const targetId = editingId.value || props.initialReminder?.id
  const resolvedBikeId = bikeId.value || (!bikeTouched.value ? defaultBike() : '')

  busy.value = true
  try {
    const payload = {
      title: title.value.trim(),
      dueOn: dueOn.value,
      repeatYearly: repeatYearly.value,
      bikeId: resolvedBikeId || (targetId ? null : undefined),
      amountCents: amountCents ?? (targetId ? null : undefined),
      provider: provider.value.trim() || (targetId ? null : undefined),
      policyNumber: policyNumber.value.trim() || (targetId ? null : undefined),
    }

    const res = targetId
      ? await mutate(`/api/reminders/${targetId}`, payload, { method: 'PATCH', queue: true })
      : await mutate('/api/reminders', payload, { queue: true })

    open.value = false
    toast.show(isQueued(res) ? t.value.reminderSheet.savedHere(title.value.trim()) : t.value.reminderSheet.added(title.value.trim()))
    emit('saved')
  } catch (e) {
    const { data } = e as { data?: { statusMessage?: string } }
    error.value = data?.statusMessage === 'Invalid dueOn date' ? t.value.reminderSheet.noSuchDate : errorMessage(e, t.value.reminderSheet.failed, true)
  } finally {
    busy.value = false
  }
}

const field = 'mt-1 block w-full rounded-xl bg-bg px-3 py-3 text-base normal-case text-white outline-none focus:ring-2 focus:ring-accent'
</script>

<template>
  <Sheet v-model:open="open" :title="editingId || props.initialReminder ? t.reminderSheet.editTitle : t.reminderSheet.title" testid="reminder-sheet">
    <form @submit.prevent="save" @input="error = ''">
      <div class="mb-3 flex flex-wrap gap-2" role="group" :aria-label="t.reminderSheet.presetsLabel">
        <button
          v-for="p in presets"
          :key="p.id"
          type="button"
          :aria-pressed="title === p.label"
          :data-testid="`preset-${p.id}`"
          class="rounded-full px-3 py-1.5 text-[13px] flex items-center gap-1.5"
          :class="title === p.label ? 'bg-accent font-bold text-on-accent' : 'bg-bg text-text'"
          @click="pickPreset(p.id, p.label)"
        >
          <span>{{ p.label }}</span>
          <span v-if="hasExisting(p.id)" class="text-[11px] opacity-75 font-tag" :title="t.reminderSheet.updatingExisting">✓</span>
        </button>
      </div>

      <Transition
        enter-active-class="transition-all duration-200 ease-out"
        enter-from-class="-translate-y-1 opacity-0"
        enter-to-class="translate-y-0 opacity-100"
        leave-active-class="transition-all duration-150 ease-in"
        leave-from-class="translate-y-0 opacity-100"
        leave-to-class="-translate-y-1 opacity-0"
      >
        <p v-if="editingId" class="mb-3 rounded-lg bg-surface px-3 py-2 text-xs text-ok-text border border-ok/20 font-medium flex items-center gap-1.5" data-testid="updating-notice">
          <span>✓</span> {{ t.reminderSheet.updatingExisting }}
        </p>
      </Transition>

      <label class="block text-[11px] uppercase tracking-wider text-muted">
        {{ t.reminderSheet.name }}
        <input v-model="title" autocomplete="off" maxlength="80" data-testid="rem-title" :class="field">
      </label>

      <div class="mt-3 flex gap-2.5">
        <label class="flex-1 text-[11px] uppercase tracking-wider text-muted">
          {{ t.reminderSheet.dueOn }}
          <input v-model="dueOn" type="date" :min="todayLocal()" required data-testid="rem-date" :class="field">
        </label>
        <label class="flex-1 text-[11px] uppercase tracking-wider text-muted">
          {{ t.reminderSheet.bike }}
          <select v-model="bikeId" data-testid="rem-bike" :class="field" @change="bikeTouched = true">
            <option value="">{{ t.common.allBikes }}</option>
            <option v-for="b in props.bikes" :key="b.id" :value="b.id">{{ b.name }}</option>
          </select>
        </label>
      </div>

      <!-- Cost and Provider / Insurer -->
      <div class="mt-3 grid grid-cols-2 gap-2.5">
        <label class="block text-[11px] uppercase tracking-wider text-muted">
          {{ t.reminderSheet.cost }}
          <input v-model="amount" inputmode="decimal" :placeholder="t.reminderSheet.costPh" data-testid="rem-amount" :class="field">
        </label>
        <label class="block text-[11px] uppercase tracking-wider text-muted">
          {{ t.reminderSheet.provider }}
          <input v-model="provider" maxlength="100" autocomplete="off" :placeholder="t.reminderSheet.providerPh" data-testid="rem-provider" :class="field">
        </label>
      </div>

      <!-- Policy number / Reference -->
      <label class="mt-3 block text-[11px] uppercase tracking-wider text-muted">
        {{ t.reminderSheet.policy }}
        <input v-model="policyNumber" maxlength="50" autocomplete="off" :placeholder="t.reminderSheet.policyPh" data-testid="rem-policy" :class="field">
      </label>

      <label class="mt-3 flex items-center gap-2.5 text-sm text-text">
        <input v-model="repeatYearly" type="checkbox" class="h-5 w-5 accent-accent" data-testid="rem-yearly">
        {{ t.reminderSheet.yearly }}
      </label>
      <p v-if="error" role="alert" class="mt-3 text-sm text-danger-text" data-testid="rem-error">{{ error }}</p>
      <button type="submit" :disabled="busy" class="mt-4 w-full rounded-xl bg-accent py-3.5 text-base font-bold text-on-accent disabled:opacity-60" data-testid="rem-save">{{ t.common.save }}</button>
    </form>

    <div v-if="currentTarget" class="mt-3 space-y-3 border-t border-white/10 pt-3">
      <button
        type="button"
        :disabled="busy"
        class="w-full rounded-xl border border-ok/30 bg-ok/15 py-3 text-sm font-bold text-ok-text transition hover:bg-ok/25 disabled:opacity-60"
        data-testid="rem-mark-done"
        @click="markDone"
      >
        {{ t.reminderSheet.markPaid }}
      </button>

      <div v-if="paymentHistory.length" data-testid="rem-payment-history">
        <h3 class="text-[11px] uppercase tracking-wider text-muted">{{ t.reminderSheet.paymentHistory }}</h3>
        <ul class="mt-1.5 divide-y divide-white/5 rounded-xl bg-bg px-3 py-1">
          <li v-for="p in paymentHistory" :key="p.id" class="flex items-center justify-between gap-2 py-2 text-xs" data-testid="rem-payment-row">
            <span class="min-w-0 truncate text-muted">{{ formatDate(p.at) }} · <span class="text-text">{{ p.description }}</span></span>
            <b class="shrink-0 font-tag text-white">{{ formatMoney(p.amountCents) }}</b>
          </li>
        </ul>
      </div>

      <div>
        <button
          v-if="!confirmRemove"
          type="button"
          :disabled="busy"
          class="min-h-10 w-full rounded-xl border border-danger/30 text-xs font-semibold text-danger-text transition hover:bg-danger/10"
          data-testid="rem-delete"
          @click="confirmRemove = true"
        >
          {{ t.reminderSheet.removeReminder }}
        </button>
        <div v-else class="rounded-xl bg-bg p-3" data-testid="rem-delete-confirm">
          <p class="text-xs text-white">{{ t.reminderSheet.removeAsk(title || currentTarget.title) }}</p>
          <div class="mt-2 grid grid-cols-2 gap-2">
            <button type="button" class="min-h-10 rounded-lg border border-white/15 text-xs text-muted" @click="confirmRemove = false">{{ t.common.keep }}</button>
            <button type="button" :disabled="busy" class="min-h-10 rounded-lg bg-danger text-xs font-bold text-on-danger disabled:opacity-60" data-testid="rem-delete-yes" @click="removeReminder">{{ t.common.remove }}</button>
          </div>
        </div>
      </div>
    </div>
  </Sheet>
</template>
