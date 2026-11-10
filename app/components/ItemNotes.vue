<script setup lang="ts">
import { notePhotoUrl, type ItemNoteJson } from '~/lib/item-notes'
import { errorMessage } from '~/offline/outbox'
const { t } = useI18n()

const props = defineProps<{ itemId: string; itemName: string }>()

const { get } = useApi()
const toast = useToast()
const { syncTick } = useOffline()

const notes = ref<ItemNoteJson[] | null>(null)
const error = ref('')
const sheetOpen = ref(false)
const editing = ref<ItemNoteJson | null>(null)
const viewing = ref<string | null>(null)

async function load() {
  try {
    notes.value = await get<ItemNoteJson[]>(`/api/items/${props.itemId}/notes`)
    error.value = ''
  } catch (e) {
    if (!notes.value) error.value = errorMessage(e, t.value.itemNotes.loadFailed, true)
  }
}
onMounted(load)
watch(syncTick, load)

function add() {
  editing.value = null
  sheetOpen.value = true
}
function edit(n: ItemNoteJson) {
  editing.value = n
  sheetOpen.value = true
}
async function onSaved(title: string) {
  await load()
  toast.show(t.value.itemNotes.saved(title))
}
async function onDeleted(title: string) {
  await load()
  toast.show(t.value.itemNotes.deleted(title))
}
</script>

<template>
  <section data-testid="item-notes">
    <div class="mb-1.5 mt-5 flex items-center justify-between">
      <h2 class="text-[11px] uppercase tracking-[0.08em] text-muted">{{ t.itemNotes.title }}</h2>
      <button v-if="notes?.length" type="button" class="-my-2 min-h-11 px-1 text-sm font-semibold text-accent-text" data-testid="note-add" @click="add">{{ t.itemNotes.add }}</button>
    </div>

    <p v-if="error" class="rounded-xl bg-surface p-3 text-sm text-muted" data-testid="notes-error">{{ error }}</p>

    <button
      v-else-if="notes && !notes.length"
      type="button"
      class="block w-full rounded-xl border border-dashed border-white/20 p-4 text-left"
      data-testid="note-add"
      @click="add"
    >
      <span class="block text-sm font-semibold text-accent-text">{{ t.itemNotes.addFirst }}</span>
      <span class="mt-0.5 block text-xs text-muted">{{ t.itemNotes.addHint(props.itemName) }}</span>
    </button>

    <article v-for="n in notes ?? []" :key="n.id" class="mb-2 rounded-xl bg-surface p-3" data-testid="note-card">
      <div class="flex items-start justify-between gap-2">
        <h3 class="pt-2 font-semibold text-white" data-testid="note-card-title">{{ n.title }}</h3>
        <button type="button" class="-mr-1 min-h-11 shrink-0 px-2 text-sm text-muted" :aria-label="t.itemNotes.editNamed(n.title)" data-testid="note-edit" @click="edit(n)">{{ t.common.edit }}</button>
      </div>
      <dl v-if="n.specs.length" class="mt-1 divide-y divide-white/5" data-testid="note-specs">
        <div v-for="(s, i) in n.specs" :key="i" class="flex items-baseline justify-between gap-3 py-1.5 text-sm">
          <dt class="text-muted">{{ s.label }}</dt>
          <dd class="text-right font-semibold tabular-nums text-white">{{ s.value }}</dd>
        </div>
      </dl>
      <p v-if="n.body.trim()" class="mt-2 whitespace-pre-line break-words text-sm leading-relaxed text-text" data-testid="note-body-text">{{ n.body }}</p>
      <div v-if="n.photos.length" class="mt-2 grid grid-cols-3 gap-2">
        <button
          v-for="p in n.photos"
          :key="p.id"
          type="button"
          class="aspect-square overflow-hidden rounded-lg bg-bg"
          :aria-label="t.itemNotes.openPhoto"
          data-testid="note-photo"
          @click="viewing = notePhotoUrl(n.id, p.id)"
        >
          <img :src="notePhotoUrl(n.id, p.id)" alt="" loading="lazy" class="size-full object-cover">
        </button>
      </div>
    </article>

    <NoteSheet v-model:open="sheetOpen" :item-id="props.itemId" :note="editing" @saved="onSaved" @deleted="onDeleted" />

    <div
      v-if="viewing"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-2"
      role="dialog"
      :aria-label="t.itemNotes.photo"
      data-testid="note-photo-viewer"
      @click="viewing = null"
    >
      <img :src="viewing" alt="" class="max-h-full max-w-full object-contain">
      <button type="button" class="absolute right-2 top-[calc(0.5rem+env(safe-area-inset-top))] size-11 rounded-full bg-black/60 text-2xl text-white" :aria-label="t.itemNotes.closePhoto">×</button>
    </div>
  </section>
</template>
