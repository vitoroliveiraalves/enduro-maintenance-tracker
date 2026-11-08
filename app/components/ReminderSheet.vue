<script setup lang="ts">
import { todayLocal } from '~/lib/parse-number'

const PRESETS = ['Insurance', 'IUC', 'Inspection', 'Licence'] as const

const props = defineProps<{ bikes: Array<{ id: string; name: string }> }>()
const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ saved: [] }>()
const { mutate } = useApi()

const title = ref('')
const dueOn = ref('')
const bikeId = ref('')
const repeatYearly = ref(true)
const error = ref('')
const busy = ref(false)

watch(open, (v) => {
  if (!v) return
  title.value = ''
  dueOn.value = ''
  bikeId.value = props.bikes.length === 1 ? props.bikes[0]!.id : ''
  repeatYearly.value = true
  error.value = ''
})

async function save() {
  if (busy.value) return
  error.value = ''
  if (!title.value.trim()) return void (error.value = 'Give the reminder a name, or pick one above.')
  if (!dueOn.value) return void (error.value = 'Pick the due date.')
  busy.value = true
  try {
    await mutate(
      '/api/reminders',
      { title: title.value.trim(), dueOn: dueOn.value, repeatYearly: repeatYearly.value, ...(bikeId.value ? { bikeId: bikeId.value } : {}) },
      { queue: true },
    )
    open.value = false
    emit('saved')
  } catch (e) {
    const { data } = e as { data?: { statusMessage?: string } }
    error.value = data?.statusMessage === 'Invalid dueOn date' ? 'That date doesn’t exist.' : "Couldn't save the reminder. Try again."
  } finally {
    busy.value = false
  }
}

const field = 'mt-1 block w-full rounded-xl bg-bg px-3 py-3 text-base normal-case text-white outline-none focus:ring-2 focus:ring-accent'
</script>

<template>
  <Sheet v-model:open="open" title="Add reminder" testid="reminder-sheet">
    <form @submit.prevent="save" @input="error = ''">
      <div class="mb-3 flex flex-wrap gap-2" role="group" aria-label="Presets">
        <button
          v-for="p in PRESETS"
          :key="p"
          type="button"
          :aria-pressed="title === p"
          :data-testid="`preset-${p}`"
          class="rounded-full px-3 py-1.5 text-[13px]"
          :class="title === p ? 'bg-accent font-bold text-[#111]' : 'bg-bg text-text'"
          @click="title = p"
        >
          {{ p }}
        </button>
      </div>
      <label class="block text-[11px] uppercase tracking-wider text-muted">
        Name
        <input v-model="title" autocomplete="off" maxlength="80" data-testid="rem-title" :class="field">
      </label>
      <div class="mt-3 flex gap-2.5">
        <label class="flex-1 text-[11px] uppercase tracking-wider text-muted">
          Due on
          <input v-model="dueOn" type="date" :min="todayLocal()" required data-testid="rem-date" :class="field">
        </label>
        <label class="flex-1 text-[11px] uppercase tracking-wider text-muted">
          Bike
          <select v-model="bikeId" data-testid="rem-bike" :class="field">
            <option value="">All bikes</option>
            <option v-for="b in props.bikes" :key="b.id" :value="b.id">{{ b.name }}</option>
          </select>
        </label>
      </div>
      <label class="mt-3 flex items-center gap-2.5 text-sm text-text">
        <input v-model="repeatYearly" type="checkbox" class="h-5 w-5 accent-[#ff6a00]" data-testid="rem-yearly">
        Repeats every year
      </label>
      <p v-if="error" role="alert" class="mt-3 text-sm text-danger" data-testid="rem-error">{{ error }}</p>
      <button type="submit" :disabled="busy" class="mt-4 w-full rounded-xl bg-accent py-3.5 text-base font-bold text-black disabled:opacity-60" data-testid="rem-save">Save</button>
    </form>
  </Sheet>
</template>
