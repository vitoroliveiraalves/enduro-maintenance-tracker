<script setup lang="ts">
import { errorMessage } from '~/offline/outbox'
import { todayLocal } from '~/lib/parse-number'
const { t } = useI18n()


const props = defineProps<{ bikes: Array<{ id: string; name: string }>; defaultBikeId?: string }>()
const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ saved: [] }>()
const { mutate } = useApi()
const toast = useToast()
// Preset titles in the rider's language; the testid keeps the English word.
const PRESETS = [['Insurance', 'insurance'], ['IUC', 'iuc'], ['Inspection', 'inspection'], ['Licence', 'licence']] as const
const presets = computed(() => PRESETS.map(([id, k]) => ({ id, label: t.value.reminderSheet.presets[k] })))

const title = ref('')
const dueOn = ref('')
const bikeId = ref('')
const repeatYearly = ref(true)
const error = ref('')
const busy = ref(false)

// "All bikes" until the rider picks; a lone bike is the default, even when
// the bike list arrives after the sheet opened (slow network).
const bikeTouched = ref(false)
const defaultBike = () => props.defaultBikeId || (props.bikes.length === 1 ? props.bikes[0]!.id : '')

watch(open, (v) => {
  if (!v) return
  title.value = ''
  dueOn.value = ''
  bikeTouched.value = false
  bikeId.value = defaultBike()
  repeatYearly.value = true
  error.value = ''
})
watch(
  () => props.bikes,
  () => {
    if (open.value && !bikeTouched.value) bikeId.value = defaultBike()
  },
)

async function save() {
  if (busy.value) return
  error.value = ''
  if (!title.value.trim()) return void (error.value = t.value.reminderSheet.needName)
  if (!dueOn.value) return void (error.value = t.value.reminderSheet.needDate)
  const year = Number(dueOn.value.slice(0, 4))
  if (!(year >= 1900 && year <= 2100)) return void (error.value = t.value.reminderSheet.before2101)
  busy.value = true
  try {
    const res = await mutate(
      '/api/reminders',
      { title: title.value.trim(), dueOn: dueOn.value, repeatYearly: repeatYearly.value, ...(bikeId.value ? { bikeId: bikeId.value } : {}) },
      { queue: true },
    )
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
  <Sheet v-model:open="open" :title="t.reminderSheet.title" testid="reminder-sheet">
    <form @submit.prevent="save" @input="error = ''">
      <div class="mb-3 flex flex-wrap gap-2" role="group" :aria-label="t.reminderSheet.presetsLabel">
        <button
          v-for="p in presets"
          :key="p.id"
          type="button"
          :aria-pressed="title === p.label"
          :data-testid="`preset-${p.id}`"
          class="rounded-full px-3 py-1.5 text-[13px]"
          :class="title === p.label ? 'bg-accent font-bold text-on-accent' : 'bg-bg text-text'"
          @click="title = p.label"
        >
          {{ p.label }}
        </button>
      </div>
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
      <label class="mt-3 flex items-center gap-2.5 text-sm text-text">
        <input v-model="repeatYearly" type="checkbox" class="h-5 w-5 accent-accent" data-testid="rem-yearly">
        {{ t.reminderSheet.yearly }}
      </label>
      <p v-if="error" role="alert" class="mt-3 text-sm text-danger-text" data-testid="rem-error">{{ error }}</p>
      <button type="submit" :disabled="busy" class="mt-4 w-full rounded-xl bg-accent py-3.5 text-base font-bold text-on-accent disabled:opacity-60" data-testid="rem-save">{{ t.common.save }}</button>
    </form>
  </Sheet>
</template>
