<script setup lang="ts">
import { downscaleImage } from '~/lib/image-downscale'
import { errorMessage, OFFLINE_MESSAGE, OfflineError } from '~/offline/outbox'
import { queuePhotos } from '~/offline/photos'
import { readSession } from '~/offline/session'

const MAX_PAGES = 5
const PHOTO_ERROR = "Couldn't read that photo — try another or choose a file."
const online = useOnline()
const { mutate } = useApi()
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
      error.value = `At most ${MAX_PAGES} pages per invoice.`
      break
    }
    try {
      const blob = await downscaleImage(f)
      pages.value.push({ id: ++seq, file: blob, url: URL.createObjectURL(blob) })
    } catch {
      // e.g. HEIC outside Safari: the browser can't decode it
      error.value = PHOTO_ERROR
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
  if (!userId) return void (error.value = OFFLINE_MESSAGE)
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
    if (err instanceof OfflineError) await keepForLater(files, qrRaw).catch(() => (error.value = 'Could not save the photos on this phone. Try again.'))
    else error.value = errorMessage(err, 'Could not upload the invoice. Try again.')
  } finally {
    busy.value = false
  }
}

async function chooseFile(e: Event) {
  const input = e.target as HTMLInputElement
  const picked = Array.from(input.files ?? [])
  input.value = ''
  if (!picked.length) return
  if (picked.length > MAX_PAGES) {
    error.value = `At most ${MAX_PAGES} pages per invoice.`
    return
  }
  const isPdf = picked.some((f) => f.type === 'application/pdf')
  if (isPdf && picked.length > 1) {
    error.value = 'Choose one PDF or up to 5 photos.'
    return
  }
  if (isPdf && picked[0]!.size > 10 * 1024 * 1024) {
    error.value = 'PDF too large (10 MB max).'
    return
  }
  busy.value = true
  let files: Blob[]
  try {
    files = isPdf ? [picked[0]!] : await Promise.all(picked.map((f) => downscaleImage(f)))
  } catch {
    error.value = PHOTO_ERROR
    busy.value = false
    return
  }
  await send(files)
}

onBeforeUnmount(() => pages.value.forEach((p) => URL.revokeObjectURL(p.url)))
</script>

<template>
  <main class="mx-auto max-w-md p-4">
    <h1 class="text-2xl font-bold text-accent">Add invoice</h1>
    <p class="mt-1 text-sm text-muted">Photograph the invoice or choose a file. The QR code is read on your phone.</p>

    <p v-if="!online" role="status" data-testid="offline-banner" class="mt-4 rounded-lg border border-warn/40 bg-warn/10 p-3 text-sm text-warn">
      You're offline — photos are saved on this phone and uploaded when you're back online.
    </p>

    <div class="mt-5 grid gap-3">
      <label
        class="block rounded-lg bg-accent px-4 py-3 text-center font-semibold text-black"
        :class="{ 'pointer-events-none opacity-40': busy || pages.length >= MAX_PAGES }"
      >
        Take photos
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
        Choose file
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
          <img :src="p.url" :alt="`Page ${i + 1}`" class="aspect-[3/4] w-full rounded-lg object-cover">
          <button
            type="button"
            class="absolute right-1 top-1 size-7 rounded-full bg-black/70 text-lg leading-none"
            :aria-label="`Remove page ${i + 1}`"
            @click="remove(p.id)"
          >
            ×
          </button>
        </li>
      </ul>
      <button
        type="button"
        class="mt-4 w-full rounded-lg bg-accent px-4 py-3 font-semibold text-black disabled:opacity-40"
        :disabled="busy"
        @click="send(pages.map((p) => p.file))"
      >
        {{ busy ? (online ? 'Uploading…' : 'Saving…') : `${online ? 'Upload' : 'Save'} ${pages.length} ${pages.length === 1 ? 'page' : 'pages'}` }}
      </button>
    </section>

    <p v-if="busy && !pages.length" class="mt-4 text-sm text-muted" role="status">Uploading…</p>
    <p v-if="savedOffline" role="status" class="mt-4 rounded-lg bg-surface p-3 text-sm text-text" data-testid="invoice-saved-offline">
      Saved on this phone. It uploads and gets read when you're back online — then review it here.
    </p>
    <p v-if="error" role="alert" class="mt-4 text-sm text-danger">{{ error }}</p>
  </main>
</template>
