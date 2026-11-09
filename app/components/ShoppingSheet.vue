<script setup lang="ts">
import { errorMessage } from '~/offline/outbox'
import type { ManualEntry, ShelfPart } from '~/lib/shelf'

const props = defineProps<{ entry: ManualEntry | null; bikes: Array<{ id: string; name: string }>; parts: ShelfPart[] }>()
const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ changed: [] }>()
const { mutate } = useApi()
const toast = useToast()

const text = ref('')
const bikeId = ref('')
const partId = ref('')
const error = ref('')
const busy = ref(false)
const confirmDelete = ref(false)

const isNew = computed(() => !props.entry)
// Only the real entry can be edited online-or-queued; a still-queued one has no server id yet.
const editable = computed(() => !props.entry?.pending)

watch(open, (v) => {
  if (!v) return
  error.value = ''
  confirmDelete.value = false
  text.value = props.entry?.text ?? ''
  bikeId.value = props.entry?.bikeId ?? ''
  partId.value = props.entry?.partId ?? ''
})

async function save() {
  if (busy.value) return
  const t = text.value.trim()
  if (!t) return void (error.value = 'Write what to buy.')
  busy.value = true
  try {
    const res = props.entry
      ? await mutate(`/api/shopping/${props.entry.id}`, { text: t }, { method: 'PATCH', queue: true })
      : await mutate('/api/shopping', { text: t, bikeId: bikeId.value || null, partId: partId.value || null }, { queue: true })
    open.value = false
    toast.show(isQueued(res) ? 'Saved on this phone · syncs when online' : 'Added to your list')
    emit('changed')
  } catch (e) {
    error.value = errorMessage(e, "Couldn't save. Try again.")
  } finally {
    busy.value = false
  }
}

async function remove() {
  if (!props.entry || busy.value) return
  busy.value = true
  try {
    await mutate(`/api/shopping/${props.entry.id}`, {}, { method: 'DELETE' })
    open.value = false
    emit('changed')
  } catch (e) {
    error.value = errorMessage(e, "Couldn't remove it. Try again.")
  } finally {
    busy.value = false
    confirmDelete.value = false
  }
}

const field = 'mt-1 block w-full rounded-xl bg-bg px-3 py-3 text-base normal-case text-white outline-none focus:ring-2 focus:ring-accent'
const lbl = 'block text-[11px] uppercase tracking-wider text-muted'
</script>

<template>
  <Sheet v-model:open="open" :title="isNew ? 'Add to list' : 'Edit entry'" testid="shopping-sheet">
    <form @submit.prevent="save" @input="error = ''">
      <label :class="lbl">
        What to buy
        <input v-model="text" maxlength="120" autocomplete="off" placeholder="Chain lube" data-testid="buy-text" :class="field">
      </label>
      <template v-if="isNew">
        <label class="mt-3 block" :class="lbl">
          Bike
          <select v-model="bikeId" data-testid="buy-bike" :class="field">
            <option value="">Any bike</option>
            <option v-for="b in props.bikes" :key="b.id" :value="b.id">{{ b.name }}</option>
          </select>
        </label>
        <label class="mt-3 block" :class="lbl">
          Shelf part
          <select v-model="partId" data-testid="buy-part" :class="field">
            <option value="">None</option>
            <option v-for="p in props.parts.filter((x) => !x.pending)" :key="p.id" :value="p.id">{{ p.name }}</option>
          </select>
        </label>
      </template>
      <p v-if="error" role="alert" class="mt-3 text-sm text-danger" data-testid="buy-error">{{ error }}</p>
      <button type="submit" :disabled="busy || !editable" class="mt-4 w-full rounded-xl bg-accent py-3.5 text-base font-bold text-black disabled:opacity-60" data-testid="buy-save">Save</button>
    </form>

    <div v-if="!isNew && editable" class="mt-4">
      <button v-if="!confirmDelete" type="button" class="min-h-11 w-full rounded-xl border border-danger/40 text-sm font-semibold text-danger-text" data-testid="buy-delete" @click="confirmDelete = true">Remove from list</button>
      <div v-else class="rounded-xl bg-bg p-3">
        <p class="text-sm text-white">Remove "{{ props.entry?.text }}"?</p>
        <div class="mt-2.5 grid grid-cols-2 gap-2">
          <button type="button" class="min-h-11 rounded-lg border border-white/15 text-sm" @click="confirmDelete = false">Keep it</button>
          <button type="button" :disabled="busy" class="min-h-11 rounded-lg bg-danger text-sm font-bold text-black disabled:opacity-60" data-testid="buy-delete-yes" @click="remove">Remove</button>
        </div>
      </div>
    </div>
  </Sheet>
</template>
