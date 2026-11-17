<script setup lang="ts">
import { errorMessage } from '~/offline/outbox'

export type BikeManualEntry = {
  id: string
  bikeId: string
  kind: 'shop' | 'user'
  title: string
  fileName: string
  sizeBytes: number
  createdAt: string
  updatedAt: string
}

const MAX_MANUAL_BYTES = 50 * 1024 * 1024

const props = defineProps<{
  bikeId: string
  manuals: BikeManualEntry[]
}>()

const emit = defineEmits<{
  updated: [manuals: BikeManualEntry[]]
}>()

const open = defineModel<boolean>('open', { default: false })
const { t } = useI18n()
const { mutate } = useApi()
const toast = useToast()

const kind = ref<'shop' | 'user'>('shop')
const title = ref('')
const selectedFile = ref<File | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const busy = ref(false)
const error = ref('')
const confirmDeleteId = ref<string | null>(null)
const deletingId = ref<string | null>(null)
const activeManual = ref<BikeManualEntry | null>(null)

watch(open, (isOpen) => {
  if (!isOpen) activeManual.value = null
})

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function fileUrl(manualId: string, download = false): string {
  const base = `/api/bikes/${props.bikeId}/manuals/${manualId}/file`
  return download ? `${base}?download=1` : base
}

function onFileChange(e: Event) {
  error.value = ''
  const input = e.target as HTMLInputElement
  const file = input.files?.[0] ?? null
  if (!file) {
    selectedFile.value = null
    return
  }
  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
  if (!isPdf) {
    error.value = t.value.manuals.notPdf
    selectedFile.value = null
    input.value = ''
    return
  }
  if (file.size > MAX_MANUAL_BYTES) {
    error.value = t.value.manuals.tooLarge
    selectedFile.value = null
    input.value = ''
    return
  }
  selectedFile.value = file
}

async function uploadManual() {
  if (busy.value) return
  error.value = ''
  if (!selectedFile.value) {
    error.value = t.value.manuals.needFile
    return
  }
  busy.value = true
  try {
    const form = new FormData()
    form.append('clientId', crypto.randomUUID())
    form.append('kind', kind.value)
    if (title.value.trim()) form.append('title', title.value.trim())
    form.append('file', selectedFile.value, selectedFile.value.name)

    const created = await mutate<BikeManualEntry>(`/api/bikes/${props.bikeId}/manuals`, form)
    emit('updated', [created, ...props.manuals.filter((m) => m.id !== created.id)])
    toast.show(t.value.manuals.saved)
    title.value = ''
    selectedFile.value = null
    if (fileInput.value) fileInput.value.value = ''
  } catch (e) {
    error.value = errorMessage(e, t.value.manuals.uploadFailed)
  } finally {
    busy.value = false
  }
}

async function removeManual(manualId: string) {
  if (deletingId.value) return
  deletingId.value = manualId
  error.value = ''
  try {
    await mutate(`/api/bikes/${props.bikeId}/manuals/${manualId}`, {}, { method: 'DELETE' })
    if (activeManual.value?.id === manualId) activeManual.value = null
    emit('updated', props.manuals.filter((m) => m.id !== manualId))
    confirmDeleteId.value = null
    toast.show(t.value.manuals.deleted)
  } catch (e) {
    error.value = errorMessage(e, t.value.manuals.deleteFailed)
  } finally {
    deletingId.value = null
  }
}
</script>

<template>
  <Sheet v-model:open="open" :title="t.manuals.title" testid="manuals-sheet">
    <div v-if="activeManual" class="space-y-3">
      <div class="flex items-center justify-between gap-2">
        <button
          type="button"
          class="rounded-lg bg-bg border border-white/10 px-2.5 py-1.5 text-xs font-semibold text-text hover:border-accent transition"
          data-testid="manual-viewer-back"
          @click="activeManual = null"
        >
          {{ t.viewer.backToList }}
        </button>
        <div class="min-w-0 flex-1 flex items-center justify-end gap-1.5">
          <span
            class="shrink-0 rounded px-1.5 py-0.5 font-tag text-[10px] font-bold uppercase tracking-wider"
            :class="activeManual.kind === 'shop' ? 'bg-accent/20 text-accent-text' : 'bg-bg text-muted'"
          >
            {{ activeManual.kind === 'shop' ? t.manuals.shopShort : t.manuals.userShort }}
          </span>
          <span class="text-xs font-semibold text-white truncate" data-testid="manual-viewer-title">
            {{ activeManual.title }}
          </span>
        </div>
      </div>

      <PdfDocViewer
        :src="fileUrl(activeManual.id)"
        :download-url="fileUrl(activeManual.id, true)"
        :file-name="activeManual.fileName"
        :title="activeManual.title"
      />
    </div>

    <div v-else class="space-y-4">
      <div v-if="manuals.length" class="space-y-2" data-testid="manuals-list">
        <div
          v-for="m in manuals"
          :key="m.id"
          class="rounded-xl border border-track bg-surface p-3"
          data-testid="manual-row"
        >
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-1.5">
                <span
                  class="rounded px-1.5 py-0.5 font-tag text-[10px] font-bold uppercase tracking-wider"
                  :class="m.kind === 'shop' ? 'bg-accent/20 text-accent-text' : 'bg-bg text-muted'"
                  data-testid="manual-kind-badge"
                >
                  {{ m.kind === 'shop' ? t.manuals.shopShort : t.manuals.userShort }}
                </span>
                <span class="font-tag text-[11px] text-muted tabular-nums">{{ formatBytes(m.sizeBytes) }}</span>
              </div>
              <div class="mt-1 text-sm font-semibold text-white truncate" data-testid="manual-title">{{ m.title }}</div>
              <div class="text-[11px] text-muted truncate font-tag">{{ m.fileName }}</div>
            </div>
          </div>

          <div v-if="confirmDeleteId === m.id" class="mt-2.5 flex items-center justify-between gap-2 rounded-lg border border-danger/40 bg-danger/15 p-2 text-xs">
            <span class="text-text truncate">{{ t.manuals.deleteAsk(m.title) }}</span>
            <div class="flex shrink-0 gap-1.5">
              <button
                type="button"
                class="rounded bg-danger px-2.5 py-1 font-bold text-on-danger disabled:opacity-60"
                :disabled="deletingId === m.id"
                data-testid="manual-delete-confirm"
                @click="removeManual(m.id)"
              >
                {{ t.common.remove }}
              </button>
              <button
                type="button"
                class="rounded px-2 py-1 text-muted hover:text-white"
                @click="confirmDeleteId = null"
              >
                {{ t.common.keep }}
              </button>
            </div>
          </div>

          <div v-else class="mt-2.5 flex items-center gap-2">
            <a
              :href="fileUrl(m.id)"
              target="_blank"
              rel="noopener"
              class="flex-1 rounded-lg bg-bg border border-white/10 py-1.5 px-2.5 text-center text-xs font-semibold text-accent-text hover:border-accent transition"
              data-testid="manual-open"
              @click.prevent="activeManual = m"
            >
              {{ t.manuals.open }}
            </a>
            <a
              :href="fileUrl(m.id, true)"
              :download="m.fileName"
              class="rounded-lg bg-bg border border-white/10 py-1.5 px-2.5 text-xs font-semibold text-text hover:border-accent transition"
              data-testid="manual-download"
            >
              {{ t.manuals.download }}
            </a>
            <button
              type="button"
              class="rounded-lg bg-bg border border-white/10 py-1.5 px-2.5 text-xs font-semibold text-danger-text hover:border-danger/50 transition"
              data-testid="manual-delete"
              @click="confirmDeleteId = m.id"
            >
              {{ t.common.remove }}
            </button>
          </div>
        </div>
      </div>

      <div v-else class="py-3 text-center space-y-2" data-testid="manuals-empty">
        <div class="mx-auto flex size-11 items-center justify-center rounded-full bg-surface text-muted">
          <Icon name="book" :size="22" />
        </div>
        <p class="text-sm font-semibold text-white">{{ t.manuals.empty }}</p>
        <p class="text-xs text-muted leading-relaxed max-w-xs mx-auto">{{ t.manuals.emptyHint }}</p>
      </div>

      <form class="rounded-xl border border-track bg-surface p-3.5 space-y-3" data-testid="manual-upload-form" @submit.prevent="uploadManual">
        <div class="text-xs font-tag font-bold uppercase tracking-wider text-white">{{ t.manuals.addTitle }}</div>

        <div>
          <span class="block text-[11px] uppercase tracking-wider text-muted font-tag mb-1">{{ t.manuals.kindLabel }}</span>
          <div class="flex gap-2" role="radiogroup">
            <button
              type="button"
              role="radio"
              :aria-checked="kind === 'shop'"
              data-testid="manual-kind-shop"
              class="flex-1 py-2 rounded-xl border text-xs font-tag font-bold transition"
              :class="kind === 'shop' ? 'bg-accent border-accent text-on-accent' : 'bg-bg border-white/10 text-muted hover:text-white'"
              @click="kind = 'shop'"
            >
              {{ t.manuals.shop }}
            </button>
            <button
              type="button"
              role="radio"
              :aria-checked="kind === 'user'"
              data-testid="manual-kind-user"
              class="flex-1 py-2 rounded-xl border text-xs font-tag font-bold transition"
              :class="kind === 'user' ? 'bg-accent border-accent text-on-accent' : 'bg-bg border-white/10 text-muted hover:text-white'"
              @click="kind = 'user'"
            >
              {{ t.manuals.user }}
            </button>
          </div>
        </div>

        <label class="block text-[11px] uppercase tracking-wider text-muted font-tag">
          {{ t.manuals.titleLabel }}
          <input
            v-model="title"
            maxlength="120"
            autocomplete="off"
            :placeholder="t.manuals.titlePh"
            data-testid="manual-title-input"
            class="mt-1 block w-full rounded-xl bg-bg px-3 py-2.5 text-sm normal-case text-white outline-none focus:ring-2 focus:ring-accent"
          >
        </label>

        <label class="block text-[11px] uppercase tracking-wider text-muted font-tag">
          {{ t.manuals.fileLabel }}
          <input
            ref="fileInput"
            type="file"
            accept="application/pdf,.pdf"
            data-testid="manual-file-input"
            class="mt-1 block w-full rounded-xl bg-bg px-3 py-2 text-xs text-muted file:mr-3 file:rounded-lg file:border-0 file:bg-surface file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-text"
            @change="onFileChange"
          >
        </label>

        <p v-if="error" role="alert" class="text-xs text-danger-text" data-testid="manual-error">{{ error }}</p>

        <button
          type="submit"
          :disabled="busy"
          class="w-full rounded-xl bg-accent py-2.5 text-sm font-bold text-on-accent disabled:opacity-60"
          data-testid="manual-upload-submit"
        >
          {{ busy ? t.manuals.uploading : t.manuals.upload }}
        </button>
      </form>
    </div>
  </Sheet>
</template>
