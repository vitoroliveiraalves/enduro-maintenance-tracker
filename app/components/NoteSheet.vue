<script setup lang="ts">
import { downscaleImage } from '~/lib/image-downscale'
import { errorMessage } from '~/offline/outbox'
import { notePhotoUrl, type ItemNoteJson } from '~/lib/item-notes'

const props = defineProps<{ itemId: string; note: ItemNoteJson | null }>()
const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ saved: [title: string]; deleted: [title: string] }>()

const { mutate } = useApi()

type SpecDraft = { key: number; label: string; value: string }
type NewPhoto = { key: number; clientId: string; blob: Blob; url: string }

const MAX_PHOTOS = 6
const STARTERS = [
  { title: 'Torque specs', specs: ['', ''], body: '' },
  { title: 'How to', specs: [], body: '1. ' },
  { title: 'Parts & fluids', specs: ['', ''], body: '' },
] as const

const title = ref('')
const body = ref('')
const specs = ref<SpecDraft[]>([])
const keptPhotos = ref<Array<{ id: string }>>([])
const newPhotos = ref<NewPhoto[]>([])
const error = ref('')
const busy = ref(false)
const confirmDelete = ref(false)
let seq = 0
// One id per "add this note" intent: a double tap or a retry never makes two.
let clientId = crypto.randomUUID()
// Set once a new note exists on the server: a retry after a failed photo upload edits it.
let createdId: string | null = null

const editing = computed(() => props.note !== null)
const photoCount = computed(() => keptPhotos.value.length + newPhotos.value.length)

function dropNewPhotos() {
  for (const p of newPhotos.value) URL.revokeObjectURL(p.url)
  newPhotos.value = []
}

watch(open, (isOpen) => {
  if (!isOpen) return dropNewPhotos()
  const n = props.note
  title.value = n?.title ?? ''
  body.value = n?.body ?? ''
  specs.value = (n?.specs ?? []).map((s) => ({ key: ++seq, ...s }))
  keptPhotos.value = [...(n?.photos ?? [])]
  error.value = ''
  confirmDelete.value = false
  if (!n) clientId = crypto.randomUUID()
  createdId = null
}, { immediate: true })

function useStarter(s: (typeof STARTERS)[number]) {
  title.value = s.title
  if (!body.value.trim()) body.value = s.body
  if (!specs.value.length) specs.value = s.specs.map(() => ({ key: ++seq, label: '', value: '' }))
}
const addSpec = () => specs.value.push({ key: ++seq, label: '', value: '' })

const picker = ref<HTMLInputElement | null>(null)
async function onPick(e: Event) {
  const input = e.target as HTMLInputElement
  const files = [...(input.files ?? [])]
  input.value = ''
  error.value = ''
  for (const f of files) {
    if (photoCount.value >= MAX_PHOTOS) {
      error.value = `At most ${MAX_PHOTOS} photos per note.`
      break
    }
    try {
      const blob = await downscaleImage(f)
      newPhotos.value.push({ key: ++seq, clientId: crypto.randomUUID(), blob, url: URL.createObjectURL(blob) })
    } catch {
      error.value = 'That file could not be read as a photo.'
    }
  }
}
function removeNew(key: number) {
  const p = newPhotos.value.find((x) => x.key === key)
  if (p) URL.revokeObjectURL(p.url)
  newPhotos.value = newPhotos.value.filter((x) => x.key !== key)
}

async function save() {
  if (busy.value) return
  error.value = ''
  if (!title.value.trim()) return void (error.value = 'Give the note a title, or pick one above.')
  // A line with only a value is a typo; a line with only a label is a reminder to self.
  const lines = specs.value.filter((s) => s.label.trim() || s.value.trim())
  if (lines.some((s) => !s.label.trim())) return void (error.value = 'Each spec line needs a name, like "Axle nut".')
  const payload = { title: title.value.trim(), body: body.value, specs: lines.map((s) => ({ label: s.label.trim(), value: s.value.trim() })) }
  busy.value = true
  try {
    const existingId = props.note?.id ?? createdId
    const note = existingId
      ? await mutate<ItemNoteJson>(`/api/notes/${existingId}`, payload, { method: 'PATCH' })
      : await mutate<ItemNoteJson>(`/api/items/${props.itemId}/notes`, { clientId, ...payload })
    createdId = note.id
    const removed = (props.note?.photos ?? []).filter((p) => !keptPhotos.value.some((k) => k.id === p.id))
    for (const p of removed) await mutate(`/api/notes/${note.id}/photos/${p.id}`, {}, { method: 'DELETE' })
    // Photos go one per request (each well under the size cap); a sent one leaves the list,
    // so after a failure Save again only sends the rest.
    while (newPhotos.value.length) {
      const p = newPhotos.value[0]!
      const form = new FormData()
      form.append('clientId', p.clientId)
      form.append('file', p.blob, 'photo.jpg')
      await mutate(`/api/notes/${note.id}/photos`, form)
      URL.revokeObjectURL(p.url)
      newPhotos.value.shift()
    }
    open.value = false
    emit('saved', payload.title)
  } catch (e) {
    error.value = errorMessage(e, "Couldn't save the note. Try again.")
  } finally {
    busy.value = false
  }
}

async function remove() {
  if (busy.value || !props.note) return
  busy.value = true
  try {
    await mutate(`/api/notes/${props.note.id}`, {}, { method: 'DELETE' })
    open.value = false
    emit('deleted', props.note.title)
  } catch (e) {
    error.value = errorMessage(e, "Couldn't delete the note. Try again.")
  } finally {
    busy.value = false
  }
}

onBeforeUnmount(dropNewPhotos)

const field = 'mt-1 block w-full rounded-xl bg-bg px-3 py-3 text-base normal-case text-white outline-none focus:ring-2 focus:ring-accent'
const label = 'block text-[11px] uppercase tracking-wider text-muted'
</script>

<template>
  <Sheet v-model:open="open" :title="editing ? 'Edit note' : 'Add note'" testid="note-sheet">
    <form @submit.prevent="save" @input="error = ''">
      <div v-if="!editing" class="mb-3 flex flex-wrap gap-2">
        <button
          v-for="s in STARTERS"
          :key="s.title"
          type="button"
          class="min-h-11 rounded-full border border-white/15 px-3.5 text-sm"
          :class="title === s.title ? 'border-accent text-accent' : 'text-text'"
          @click="useStarter(s)"
        >
          {{ s.title }}
        </button>
      </div>

      <label :class="label">
        Title
        <input v-model="title" autocomplete="off" maxlength="120" data-testid="note-title" :class="field">
      </label>

      <fieldset class="mt-4 min-w-0">
        <legend :class="label">Specs <span class="normal-case tracking-normal">· torque, capacities, part numbers</span></legend>
        <div v-for="(s, i) in specs" :key="s.key" class="mt-2 flex items-center gap-2" data-testid="note-spec-row">
          <input v-model="s.label" autocomplete="off" maxlength="80" :placeholder="i === 0 ? 'e.g. Axle nut' : ''" :aria-label="`Spec ${i + 1} name`" class="min-w-0 flex-[3] rounded-xl bg-bg px-3 py-3 text-base text-white outline-none focus:ring-2 focus:ring-accent">
          <input v-model="s.value" autocomplete="off" maxlength="120" :placeholder="i === 0 ? 'e.g. 90 Nm' : ''" :aria-label="`Spec ${i + 1} value`" class="min-w-0 flex-[2] rounded-xl bg-bg px-3 py-3 text-base text-white outline-none focus:ring-2 focus:ring-accent">
          <button type="button" class="size-11 shrink-0 rounded-lg text-2xl leading-none text-muted" :aria-label="`Remove spec ${i + 1}`" @click="specs = specs.filter((x) => x.key !== s.key)">×</button>
        </div>
        <button type="button" class="mt-2 min-h-11 text-sm font-semibold text-accent" data-testid="note-add-spec" @click="addSpec">+ Add spec line</button>
      </fieldset>

      <label class="mt-3" :class="label">
        Notes &amp; steps
        <textarea v-model="body" rows="5" maxlength="8000" data-testid="note-body" :class="field" class="resize-y leading-snug" />
      </label>

      <div class="mt-4">
        <p :class="label">Photos <span class="normal-case tracking-normal">· up to {{ MAX_PHOTOS }}</span></p>
        <div class="mt-2 grid grid-cols-3 gap-2">
          <div v-for="p in keptPhotos" :key="p.id" class="relative aspect-square overflow-hidden rounded-xl bg-bg">
            <img :src="notePhotoUrl(props.note!.id, p.id)" alt="" class="size-full object-cover">
            <button type="button" class="absolute right-0 top-0 size-11 text-xl font-bold text-white [text-shadow:0_1px_3px_#000]" aria-label="Remove photo" data-testid="note-photo-remove" @click="keptPhotos = keptPhotos.filter((x) => x.id !== p.id)">×</button>
          </div>
          <div v-for="p in newPhotos" :key="p.key" class="relative aspect-square overflow-hidden rounded-xl bg-bg" data-testid="note-photo-new">
            <img :src="p.url" alt="" class="size-full object-cover">
            <button type="button" class="absolute right-0 top-0 size-11 text-xl font-bold text-white [text-shadow:0_1px_3px_#000]" aria-label="Remove photo" @click="removeNew(p.key)">×</button>
          </div>
          <button
            v-if="photoCount < MAX_PHOTOS"
            type="button"
            class="flex aspect-square flex-col items-center justify-center rounded-xl border border-dashed border-white/20 text-sm text-muted"
            data-testid="note-add-photo"
            @click="picker?.click()"
          >
            <span class="text-2xl leading-none">+</span>Photo
          </button>
        </div>
        <input ref="picker" type="file" accept="image/jpeg,image/png,image/*" multiple class="sr-only" tabindex="-1" aria-hidden="true" data-testid="note-photo-input" @change="onPick">
      </div>

      <p v-if="error" role="alert" class="mt-3 text-sm text-danger" data-testid="note-error">{{ error }}</p>
      <button type="submit" :disabled="busy" class="mt-4 w-full rounded-xl bg-accent py-3.5 text-base font-bold text-on-accent disabled:opacity-60" data-testid="note-save">
        {{ busy ? 'Saving…' : 'Save note' }}
      </button>

      <template v-if="editing">
        <div v-if="confirmDelete" class="mt-3 rounded-xl bg-danger/10 p-3" data-testid="note-delete-confirm">
          <p class="text-sm text-white">Delete “{{ props.note!.title }}” and its photos?</p>
          <div class="mt-2 flex gap-2">
            <button type="button" :disabled="busy" class="min-h-11 flex-1 rounded-xl bg-danger font-bold text-on-danger disabled:opacity-60" data-testid="note-delete-yes" @click="remove">Delete</button>
            <button type="button" class="min-h-11 flex-1 rounded-xl border border-white/15" @click="confirmDelete = false">Keep</button>
          </div>
        </div>
        <button v-else type="button" class="mt-2 min-h-11 w-full text-sm text-danger-text" data-testid="note-delete" @click="confirmDelete = true">Delete note</button>
      </template>
    </form>
  </Sheet>
</template>
