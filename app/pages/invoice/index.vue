<script setup lang="ts">
import { downscaleImage } from '~/lib/image-downscale'
import { errorMessage, offlineMessage, OfflineError } from '~/offline/outbox'
import { takeShared } from '~/lib/share-target'
import { queuePhotos } from '~/offline/photos'
import { readSession } from '~/offline/session'
const { t } = useI18n()

const MAX_PAGES = 5
const online = useOnline()
const { get, mutate } = useApi()
const { money, date } = useFormatters()

type InvoiceRow = {
  id: string; status: 'reading' | 'review' | 'manual' | 'confirmed'; supplierName: string | null; issuedAt: string | null
  createdAt: string; totalCents: number | null; bikeId: string | null; bikeName: string | null; lines: number
}
const invoices = ref<InvoiceRow[] | null>(null)
const listError = ref('')
onMounted(async () => {
  try {
    invoices.value = await get<InvoiceRow[]>('/api/documents')
  } catch (e) {
    listError.value = errorMessage(e, t.value.invoice.listFailed)
  }
})
const rowNote = (r: InvoiceRow) =>
  r.status === 'reading' ? t.value.invoice.reading : r.status === 'confirmed' ? (r.bikeName ?? t.value.invoice.noBike) : t.value.invoice.notSaved
const { scan } = useQrScan()

type Page = { id: number; file: Blob; url: string }
const pages = ref<Page[]>([])
const busy = ref(false)
const error = ref('')
const savedOffline = ref(false)
const isDragging = ref(false)
let seq = 0

async function onDrop(e: DragEvent) {
  isDragging.value = false
  const picked = Array.from(e.dataTransfer?.files ?? [])
  if (picked.length) await readPicked(picked)
}

async function addPhotos(e: Event) {
  const input = e.target as HTMLInputElement
  const picked = Array.from(input.files ?? [])
  input.value = ''
  error.value = ''
  for (const f of picked) {
    if (pages.value.length >= MAX_PAGES) {
      error.value = t.value.invoice.maxPages(MAX_PAGES)
      break
    }
    try {
      const blob = await downscaleImage(f)
      pages.value.push({ id: ++seq, file: blob, url: URL.createObjectURL(blob) })
    } catch {
      // e.g. HEIC outside Safari: the browser can't decode it
      error.value = t.value.invoice.photoError
    }
  }
}

function remove(id: number) {
  const p = pages.value.find((x) => x.id === id)
  if (p) URL.revokeObjectURL(p.url)
  pages.value = pages.value.filter((x) => x.id !== id)
}

/** Offline (Ruling R12): keep the downscaled photos + QR on this phone; the next flush uploads and reads them. */
async function keepForLater(files: Blob[], qrRaw: string | null) {
  const userId = readSession()?.userId
  if (!userId) return void (error.value = offlineMessage())
  await queuePhotos({ files, qrRaw, userId })
  pages.value.forEach((p) => URL.revokeObjectURL(p.url))
  pages.value = []
  savedOffline.value = true
}

async function send(files: Blob[]) {
  busy.value = true
  error.value = ''
  savedOffline.value = false
  let qrRaw: string | null = null
  try {
    // Best-effort; a QR of another document type never blocks the upload (the server explains it).
    qrRaw = await scan(files)
    if (!online.value) return void (await keepForLater(files, qrRaw))
    const form = new FormData()
    files.forEach((f, i) => form.append('files', f, f.type === 'application/pdf' ? 'invoice.pdf' : `page-${i + 1}.jpg`))
    if (qrRaw) form.append('qrRaw', qrRaw)
    form.append('clientId', crypto.randomUUID())
    const res = await mutate<{ id: string; duplicate: boolean; status: string; qrNotice?: string }>('/api/documents', form)
    if (!res.duplicate && res.status === 'reading') {
      // Starts the read on the server; the review page polls. A refusal (429) already left the document in manual.
      await mutate(`/api/documents/${res.id}/read`, {}).catch(() => {})
    }
    const query: Record<string, string> = {}
    if (res.duplicate) query.duplicate = '1'
    if (res.qrNotice) query.qrNotice = res.qrNotice
    await navigateTo({ path: `/invoice/${res.id}`, query })
  } catch (err) {
    if (err instanceof OfflineError) await keepForLater(files, qrRaw).catch(() => (error.value = t.value.invoice.keepFailed))
    else error.value = errorMessage(err, t.value.invoice.uploadFailed)
  } finally {
    busy.value = false
  }
}

async function chooseFile(e: Event) {
  const input = e.target as HTMLInputElement
  const picked = Array.from(input.files ?? [])
  input.value = ''
  await readPicked(picked)
}

// Files shared into the app from the gallery / Files (share target) wait in a cache.
onMounted(async () => {
  const shared = await takeShared()
  if (shared.length) await readPicked(shared)
})

async function readPicked(picked: File[]) {
  if (!picked.length) return
  if (picked.length > MAX_PAGES) {
    error.value = t.value.invoice.maxPages(MAX_PAGES)
    return
  }
  const isPdf = picked.some((f) => f.type === 'application/pdf')
  if (isPdf && picked.length > 1) {
    error.value = t.value.invoice.onePdf
    return
  }
  if (isPdf && picked[0]!.size > 10 * 1024 * 1024) {
    error.value = t.value.invoice.pdfTooBig
    return
  }
  busy.value = true
  let files: Blob[]
  try {
    files = isPdf ? [picked[0]!] : await Promise.all(picked.map((f) => downscaleImage(f)))
  } catch {
    error.value = t.value.invoice.photoError
    busy.value = false
    return
  }
  await send(files)
}

onBeforeUnmount(() => pages.value.forEach((p) => URL.revokeObjectURL(p.url)))
</script>

<template>
  <main class="mx-auto max-w-md lg:max-w-7xl lg:mx-auto lg:w-full p-4 pb-6 lg:px-8 lg:py-8">
    <div class="mb-4 lg:mb-8">
      <h1 class="text-xl lg:text-3xl font-bold text-white tracking-tight">{{ t.invoice.title }}</h1>
      <p class="mt-1 text-sm lg:text-base text-muted">{{ t.invoice.intro }}</p>
    </div>

    <p v-if="!online" role="status" data-testid="offline-banner" class="mt-4 rounded-lg border border-warn/40 bg-warn/10 p-3 text-sm text-warn-text">
      {{ t.invoice.offline }}
    </p>

    <!-- Upload section with desktop drag-and-drop zone -->
    <div
      class="mt-5 rounded-2xl transition-all"
      :class="[
        isDragging
          ? 'lg:border-accent lg:bg-accent/10'
          : 'lg:border-track lg:bg-surface/30 hover:lg:border-muted/40',
        'lg:border-2 lg:border-dashed lg:p-10 lg:text-center'
      ]"
      @dragover.prevent="isDragging = true"
      @dragleave.prevent="isDragging = false"
      @drop.prevent="onDrop"
    >
      <div class="hidden lg:flex flex-col items-center justify-center pointer-events-none mb-5">
        <div class="size-14 rounded-full bg-surface border border-track flex items-center justify-center text-3xl mb-3 shadow-sm">
          🧾
        </div>
        <p class="text-base font-bold text-white">
          {{ t.invoice.dropZone }}
        </p>
        <p class="text-xs text-muted mt-1">
          {{ t.invoice.dropZoneHint }}
        </p>
      </div>

      <div class="grid gap-3 sm:grid-cols-2 lg:inline-flex lg:gap-4 lg:justify-center">
        <label
          class="block rounded-lg bg-accent px-4 py-3 text-center font-semibold text-on-accent cursor-pointer transition-transform active:scale-95 lg:min-w-44"
          :class="{ 'pointer-events-none opacity-40': busy || pages.length >= MAX_PAGES }"
        >
          {{ t.invoice.takePhotos }}
          <input
            type="file"
            accept="image/*"
            capture="environment"
            class="sr-only"
            data-testid="camera-input"
            :disabled="busy || pages.length >= MAX_PAGES"
            @change="addPhotos"
          >
        </label>
        <label
          class="block rounded-lg border border-white/15 bg-surface px-4 py-3 text-center font-semibold cursor-pointer transition-transform active:scale-95 hover:border-white/30 lg:min-w-44"
          :class="{ 'pointer-events-none opacity-40': busy }"
        >
          {{ t.invoice.chooseFile }}
          <input
            type="file"
            accept="image/jpeg,image/png,application/pdf"
            multiple
            class="sr-only"
            data-testid="file-input"
            :disabled="busy"
            @change="chooseFile"
          >
        </label>
      </div>
    </div>

    <section v-if="pages.length" class="mt-5 lg:mt-6" data-testid="pages">
      <ul class="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-3">
        <li v-for="(p, i) in pages" :key="p.id" class="relative group">
          <img :src="p.url" :alt="t.invoice.page(i + 1)" class="aspect-[3/4] w-full rounded-lg object-cover border border-track">
          <button
            type="button"
            class="absolute right-1 top-1 size-7 rounded-full bg-black/70 text-lg leading-none text-white hover:bg-black transition-colors"
            :aria-label="t.invoice.removePage(i + 1)"
            @click="remove(p.id)"
          >
            ×
          </button>
        </li>
      </ul>
      <button
        type="button"
        class="mt-4 w-full lg:max-w-xs rounded-lg bg-accent px-4 py-3 font-semibold text-on-accent disabled:opacity-40"
        :disabled="busy"
        @click="send(pages.map((p) => p.file))"
      >
        {{ busy ? (online ? t.invoice.uploading : t.common.saving) : t.invoice.sendPages(online, pages.length) }}
      </button>
    </section>

    <p v-if="busy && !pages.length" class="mt-4 text-sm text-muted" role="status">{{ t.invoice.uploading }}</p>
    <p v-if="savedOffline" role="status" class="mt-4 rounded-lg bg-surface p-3 text-sm text-text" data-testid="invoice-saved-offline">
      {{ t.invoice.savedOffline }}
    </p>
    <p v-if="error" role="alert" class="mt-4 text-sm text-danger-text">{{ error }}</p>

    <section class="mt-8 lg:mt-12" data-testid="invoice-list">
      <div class="flex items-center justify-between mb-2 lg:mb-4">
        <h2 class="text-[11px] lg:text-xs font-semibold uppercase tracking-wider text-muted">{{ t.invoice.yours }}</h2>
        <span v-if="invoices?.length" class="hidden lg:inline text-xs text-muted font-mono">{{ invoices.length }} {{ invoices.length === 1 ? 'item' : 'items' }}</span>
      </div>
      <p v-if="listError" role="alert" class="mt-2 text-sm text-danger-text">{{ listError }}</p>
      <Skeleton v-else-if="!invoices" :rows="3" height="h-14" class="mt-2" />
      <p v-else-if="invoices && !invoices.length" class="mt-2 text-sm text-muted" data-testid="invoice-list-empty">{{ t.invoice.none }}</p>
      <ul v-else-if="invoices" class="mt-2 divide-y divide-white/5 lg:divide-y-0 rounded-2xl bg-surface lg:bg-transparent lg:grid lg:grid-cols-2 xl:grid-cols-3 lg:gap-4">
        <li v-for="r in invoices" :key="r.id" class="lg:rounded-xl lg:bg-surface lg:border lg:border-track hover:lg:border-muted/40 transition-colors">
          <NuxtLink :to="`/invoice/${r.id}`" class="flex min-h-14 items-center justify-between gap-3 px-4 py-2.5 lg:p-4" data-testid="invoice-row">
            <span class="min-w-0">
              <span class="block truncate text-sm font-semibold text-white">{{ r.supplierName || t.invoice.fallbackName }}</span>
              <span class="block text-xs" :class="r.status === 'confirmed' ? 'text-muted' : 'text-warn-text'" data-testid="invoice-row-note">
                {{ date(r.issuedAt ?? r.createdAt.slice(0, 10)) }} · {{ rowNote(r) }}
              </span>
            </span>
            <span class="shrink-0 text-sm tabular-nums text-white font-mono" data-testid="invoice-row-total">{{ r.totalCents != null ? money(r.totalCents) : '—' }}</span>
          </NuxtLink>
        </li>
      </ul>
    </section>
  </main>
</template>
