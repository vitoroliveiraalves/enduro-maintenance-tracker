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
let seq = 0

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
  <main class="mx-auto max-w-md p-4">
    <h1 class="text-xl font-bold text-white">{{ t.invoice.title }}</h1>
    <p class="mt-1 text-sm text-muted">{{ t.invoice.intro }}</p>

    <p v-if="!online" role="status" data-testid="offline-banner" class="mt-4 rounded-lg border border-warn/40 bg-warn/10 p-3 text-sm text-warn-text">
      {{ t.invoice.offline }}
    </p>

    <div class="mt-5 grid gap-3">
      <label
        class="block rounded-lg bg-accent px-4 py-3 text-center font-semibold text-on-accent"
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
        class="block rounded-lg border border-white/15 bg-surface px-4 py-3 text-center font-semibold"
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

    <section v-if="pages.length" class="mt-5" data-testid="pages">
      <ul class="grid grid-cols-3 gap-2">
        <li v-for="(p, i) in pages" :key="p.id" class="relative">
          <img :src="p.url" :alt="t.invoice.page(i + 1)" class="aspect-[3/4] w-full rounded-lg object-cover">
          <button
            type="button"
            class="absolute right-1 top-1 size-7 rounded-full bg-black/70 text-lg leading-none"
            :aria-label="t.invoice.removePage(i + 1)"
            @click="remove(p.id)"
          >
            ×
          </button>
        </li>
      </ul>
      <button
        type="button"
        class="mt-4 w-full rounded-lg bg-accent px-4 py-3 font-semibold text-on-accent disabled:opacity-40"
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

    <section class="mt-8" data-testid="invoice-list">
      <h2 class="text-[11px] font-semibold uppercase tracking-wider text-muted">{{ t.invoice.yours }}</h2>
      <p v-if="listError" role="alert" class="mt-2 text-sm text-danger-text">{{ listError }}</p>
      <Skeleton v-else-if="!invoices" :rows="3" height="h-14" class="mt-2" />
      <p v-else-if="invoices && !invoices.length" class="mt-2 text-sm text-muted" data-testid="invoice-list-empty">{{ t.invoice.none }}</p>
      <ul v-else-if="invoices" class="mt-2 divide-y divide-white/5 rounded-2xl bg-surface">
        <li v-for="r in invoices" :key="r.id">
          <NuxtLink :to="`/invoice/${r.id}`" class="flex min-h-14 items-center justify-between gap-3 px-4 py-2.5" data-testid="invoice-row">
            <span class="min-w-0">
              <span class="block truncate text-sm font-semibold text-white">{{ r.supplierName || t.invoice.fallbackName }}</span>
              <span class="block text-xs" :class="r.status === 'confirmed' ? 'text-muted' : 'text-warn-text'" data-testid="invoice-row-note">
                {{ date(r.issuedAt ?? r.createdAt.slice(0, 10)) }} · {{ rowNote(r) }}
              </span>
            </span>
            <span class="shrink-0 text-sm tabular-nums text-white" data-testid="invoice-row-total">{{ r.totalCents != null ? money(r.totalCents) : '—' }}</span>
          </NuxtLink>
        </li>
      </ul>
    </section>
  </main>
</template>
