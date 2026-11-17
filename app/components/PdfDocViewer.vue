<script setup lang="ts">
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { buildPageIndex, extractSpecCandidate, loadPdfJs, searchPdfPages, type PdfPageIndex, type PdfSearchMatch, type PdfTextSpan } from '~/lib/pdf-search'
import { itemLabel } from '~/lib/server-text'
import { readManualCache, writeManualCache } from '~/offline/db'
import { errorMessage } from '~/offline/outbox'
import { matches as textMatches } from '../../shared/utils/search'

const props = defineProps<{
  src: string
  title?: string
  downloadUrl?: string
  fileName?: string
  externalTestId?: string
  items?: Array<{ id: string; name: string }>
}>()

const emit = defineEmits<{
  cached: [src: string]
  specSaved: []
}>()

const { t } = useI18n()
const { mutate } = useApi()
const toast = useToast()

const canvasEl = ref<HTMLCanvasElement | null>(null)
const loading = ref(true)
const loadError = ref(false)
const indexing = ref(false)
const totalPages = ref(0)
const currentPage = ref(1)
const zoom = ref(1)
const searchQuery = ref('')
const activeMatchIdx = ref(0)
const pageIndices = ref<PdfPageIndex[]>([])

const pinningMatch = ref<PdfSearchMatch | null>(null)
const pinItemId = ref('')
const pinLabel = ref('')
const pinValue = ref('')
const pinBusy = ref(false)
const pinError = ref('')

let pdfDoc: PDFDocumentProxy | null = null
let loadVersion = 0
let renderVersion = 0

const matches = computed(() => searchPdfPages(pageIndices.value, searchQuery.value))

const activeMatch = computed(() => matches.value[activeMatchIdx.value] ?? null)

watch(matches, (list) => {
  activeMatchIdx.value = 0
  if (list.length > 0 && list[0]!.page !== currentPage.value) {
    currentPage.value = list[0]!.page
  }
})

function nextMatch() {
  if (!matches.value.length) return
  activeMatchIdx.value = (activeMatchIdx.value + 1) % matches.value.length
  const m = matches.value[activeMatchIdx.value]
  if (m) currentPage.value = m.page
}

function prevMatch() {
  if (!matches.value.length) return
  activeMatchIdx.value = (activeMatchIdx.value - 1 + matches.value.length) % matches.value.length
  const m = matches.value[activeMatchIdx.value]
  if (m) currentPage.value = m.page
}

function selectMatch(idx: number) {
  const m = matches.value[idx]
  if (!m) return
  activeMatchIdx.value = idx
  currentPage.value = m.page
}

function startPinSpec(m: PdfSearchMatch) {
  selectMatch(m.index)
  const cand = extractSpecCandidate(m.snippetBefore, m.snippetMatch, m.snippetAfter, searchQuery.value)
  pinLabel.value = cand.label
  pinValue.value = cand.value
  pinError.value = ''
  const list = props.items ?? []
  const preferred =
    list.find((it) => textMatches(itemLabel(it.name), cand.label, searchQuery.value) || textMatches(cand.label, itemLabel(it.name))) ??
    list[0]
  pinItemId.value = preferred?.id ?? ''
  pinningMatch.value = m
}

async function savePinnedSpec() {
  if (pinBusy.value || !pinningMatch.value || !pinItemId.value) return
  pinError.value = ''
  const label = pinLabel.value.trim()
  if (!label) {
    pinError.value = t.value.noteSheet.specName
    return
  }
  pinBusy.value = true
  try {
    const titleBase = props.title ? `${props.title} (p. ${pinningMatch.value.page})` : `Manual p. ${pinningMatch.value.page}`
    await mutate(
      `/api/items/${pinItemId.value}/notes`,
      {
        title: titleBase.slice(0, 120),
        specs: [{ label: label.slice(0, 80), value: pinValue.value.trim().slice(0, 120) }],
      },
      { queue: true },
    )
    toast.show(t.value.viewer.specSaved)
    pinningMatch.value = null
    emit('specSaved')
  } catch (e) {
    pinError.value = errorMessage(e, t.value.noteSheet.failed)
  } finally {
    pinBusy.value = false
  }
}

function setPage(p: number) {
  if (!totalPages.value) return
  currentPage.value = Math.min(totalPages.value, Math.max(1, p))
}

function setZoom(z: number) {
  zoom.value = Math.min(3, Math.max(0.75, Math.round(z * 100) / 100))
}

async function renderPage() {
  const doc = pdfDoc
  const target = canvasEl.value
  if (!doc || !target || currentPage.value < 1 || currentPage.value > doc.numPages) return

  const ver = ++renderVersion
  try {
    const page = await doc.getPage(currentPage.value)
    if (ver !== renderVersion) return
    const viewport = page.getViewport({ scale: 1.5 * zoom.value })
    const offscreen = document.createElement('canvas')
    offscreen.width = Math.max(1, Math.ceil(viewport.width))
    offscreen.height = Math.max(1, Math.ceil(viewport.height))
    const offCtx = offscreen.getContext('2d')
    if (!offCtx) return

    await page.render({ canvasContext: offCtx, viewport }).promise
    if (ver !== renderVersion) return

    const pageMatches = matches.value.filter((m) => m.page === currentPage.value)
    for (const m of pageMatches) {
      const isActive = activeMatch.value?.index === m.index
      offCtx.fillStyle = isActive ? 'rgba(250, 204, 21, 0.45)' : 'rgba(250, 204, 21, 0.22)'
      offCtx.strokeStyle = isActive ? 'rgba(234, 179, 8, 0.95)' : 'rgba(234, 179, 8, 0.5)'
      offCtx.lineWidth = isActive ? 2 : 1
      for (const rect of m.rects) {
        const [x1 = 0, y1 = 0, x2 = 0, y2 = 0] = viewport.convertToViewportRectangle(rect)
        const left = Math.min(x1, x2)
        const top = Math.min(y1, y2)
        const width = Math.max(4, Math.abs(x2 - x1))
        const height = Math.max(4, Math.abs(y2 - y1))
        offCtx.fillRect(left, top, width, height)
        if (isActive) offCtx.strokeRect(left, top, width, height)
      }
    }

    const canvasNow = canvasEl.value
    if (!canvasNow || ver !== renderVersion) return
    canvasNow.width = offscreen.width
    canvasNow.height = offscreen.height
    canvasNow.getContext('2d')?.drawImage(offscreen, 0, 0)
  } catch {
    // Rendering can be interrupted by page switches or disposal; ignore stale errors.
  }
}

async function loadDocument(srcUrl: string) {
  const ver = ++loadVersion
  loading.value = true
  loadError.value = false
  indexing.value = false
  totalPages.value = 0
  currentPage.value = 1
  pageIndices.value = []
  searchQuery.value = ''
  activeMatchIdx.value = 0
  pinningMatch.value = null

  if (pdfDoc) {
    await pdfDoc.destroy().catch(() => {})
    pdfDoc = null
  }

  try {
    let arrayBuf = await readManualCache(srcUrl)
    if (!arrayBuf) {
      const res = await fetch(srcUrl, { credentials: 'same-origin' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      arrayBuf = await res.arrayBuffer()
      await writeManualCache(srcUrl, arrayBuf)
      emit('cached', srcUrl)
    }
    const data = new Uint8Array(arrayBuf)
    if (ver !== loadVersion) return

    const pdfjs = await loadPdfJs()
    const doc = await pdfjs.getDocument({ data }).promise
    if (ver !== loadVersion) {
      await doc.destroy().catch(() => {})
      return
    }

    pdfDoc = doc
    totalPages.value = doc.numPages
    currentPage.value = 1
    loading.value = false
    await nextTick()
    void renderPage()

    indexing.value = true
    const indexed: PdfPageIndex[] = []
    for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
      if (ver !== loadVersion) return
      const page = await doc.getPage(pageNum)
      if (ver !== loadVersion) return
      const content = await page.getTextContent()
      const spans: PdfTextSpan[] = []
      for (const item of content.items) {
        if (!('str' in item) || !item.str) continue
        const tx = Number(item.transform[4] ?? 0)
        const ty = Number(item.transform[5] ?? 0)
        const w = Math.max(0, Number(item.width ?? 0))
        const h = Math.max(8, Math.abs(Number(item.height ?? item.transform[3] ?? 10)))
        spans.push({ str: item.str, rect: [tx, ty, tx + w, ty + h] })
      }
      indexed.push(buildPageIndex(pageNum, spans))
    }
    if (ver !== loadVersion) return
    pageIndices.value = indexed
    indexing.value = false
    if (searchQuery.value.trim()) void renderPage()
  } catch {
    if (ver === loadVersion) {
      loadError.value = true
      loading.value = false
      indexing.value = false
    }
  }
}

watch(() => props.src, (newSrc) => {
  void loadDocument(newSrc)
}, { immediate: true })

watch([currentPage, zoom, matches, activeMatchIdx], () => {
  if (!loading.value && !loadError.value) void renderPage()
})

onBeforeUnmount(() => {
  loadVersion++
  renderVersion++
  if (pdfDoc) {
    void pdfDoc.destroy().catch(() => {})
    pdfDoc = null
  }
})
</script>

<template>
  <div class="space-y-2.5" data-testid="pdf-doc-viewer">
    <!-- Search toolbar -->
    <div class="flex items-center gap-1.5">
      <div class="relative flex-1 min-w-0">
        <input
          v-model="searchQuery"
          type="search"
          autocomplete="off"
          :placeholder="t.viewer.searchPh"
          data-testid="pdf-search-input"
          class="w-full rounded-xl bg-bg px-3 py-2 text-sm text-white placeholder-muted outline-none focus:ring-2 focus:ring-accent"
          @keydown.enter.prevent="nextMatch()"
        >
      </div>
      <span
        v-if="indexing"
        class="shrink-0 font-tag text-[11px] text-muted"
      >
        {{ t.viewer.indexing }}
      </span>
      <template v-else-if="searchQuery.trim()">
        <span
          class="shrink-0 font-tag text-xs tabular-nums"
          :class="matches.length ? 'text-accent-text font-semibold' : 'text-muted'"
          data-testid="pdf-search-count"
        >
          {{ matches.length ? t.viewer.matchCount(activeMatchIdx + 1, matches.length) : t.viewer.noMatches }}
        </span>
        <button
          type="button"
          class="size-8 shrink-0 rounded-lg bg-bg border border-white/10 text-xs font-bold text-text disabled:opacity-40 hover:border-accent transition"
          :disabled="!matches.length"
          :aria-label="t.viewer.prevMatch"
          data-testid="pdf-search-prev"
          @click="prevMatch"
        >
          ↑
        </button>
        <button
          type="button"
          class="size-8 shrink-0 rounded-lg bg-bg border border-white/10 text-xs font-bold text-text disabled:opacity-40 hover:border-accent transition"
          :disabled="!matches.length"
          :aria-label="t.viewer.nextMatch"
          data-testid="pdf-search-next"
          @click="nextMatch"
        >
          ↓
        </button>
      </template>
    </div>

    <!-- Clickable match snippet list -->
    <div
      v-if="searchQuery.trim() && matches.length"
      class="max-h-36 overflow-y-auto rounded-xl border border-track bg-bg divide-y divide-white/5"
      data-testid="pdf-search-results"
    >
      <div
        v-for="m in matches"
        :key="m.index"
        class="w-full flex items-center gap-2 px-3 py-1.5 transition hover:bg-white/5"
        :class="m.index === activeMatchIdx ? 'bg-accent/15' : ''"
        data-testid="pdf-search-hit"
      >
        <button
          type="button"
          class="min-w-0 flex-1 flex items-baseline gap-2 py-0.5 text-left text-xs"
          @click="selectMatch(m.index)"
        >
          <span class="shrink-0 rounded bg-surface px-1.5 py-0.5 font-tag text-[10px] font-bold text-accent-text tabular-nums">
            {{ t.viewer.pageShort(m.page) }}
          </span>
          <span class="min-w-0 flex-1 truncate text-muted">
            {{ m.snippetBefore }}<mark class="rounded bg-warn/30 px-0.5 text-white font-semibold">{{ m.snippetMatch }}</mark>{{ m.snippetAfter }}
          </span>
        </button>
        <button
          v-if="props.items?.length"
          type="button"
          class="shrink-0 rounded border border-white/10 bg-surface px-2 py-1 font-tag text-[10px] font-bold text-accent-text hover:border-accent transition"
          data-testid="pdf-pin-spec"
          @click.stop="startPinSpec(m)"
        >
          {{ t.viewer.pinSpec }}
        </button>
      </div>
    </div>

    <!-- Pin to specs inline form -->
    <form
      v-if="pinningMatch && props.items?.length"
      class="rounded-xl border border-accent/40 bg-surface p-3 space-y-2.5"
      data-testid="pdf-pin-spec-form"
      @submit.prevent="savePinnedSpec"
    >
      <div class="flex items-center justify-between gap-2">
        <span class="font-tag text-[11px] font-bold uppercase tracking-wider text-accent-text">{{ t.viewer.pinSpecTitle }}</span>
        <button type="button" class="text-xs text-muted hover:text-white" @click="pinningMatch = null">{{ t.common.cancel }}</button>
      </div>
      <label class="block text-[11px] uppercase tracking-wider text-muted font-tag">
        {{ t.viewer.pinSpecItem }}
        <select
          v-model="pinItemId"
          data-testid="pdf-pin-spec-item"
          class="mt-1 block w-full rounded-lg bg-bg px-2.5 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-accent"
        >
          <option v-for="it in props.items" :key="it.id" :value="it.id">{{ itemLabel(it.name) }}</option>
        </select>
      </label>
      <div class="grid grid-cols-2 gap-2">
        <label class="block text-[11px] uppercase tracking-wider text-muted font-tag">
          {{ t.viewer.pinSpecLabel }}
          <input
            v-model="pinLabel"
            maxlength="80"
            autocomplete="off"
            data-testid="pdf-pin-spec-label"
            class="mt-1 block w-full rounded-lg bg-bg px-2.5 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-accent"
          >
        </label>
        <label class="block text-[11px] uppercase tracking-wider text-muted font-tag">
          {{ t.viewer.pinSpecValue }}
          <input
            v-model="pinValue"
            maxlength="120"
            autocomplete="off"
            data-testid="pdf-pin-spec-value"
            class="mt-1 block w-full rounded-lg bg-bg px-2.5 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-accent"
          >
        </label>
      </div>
      <p v-if="pinError" role="alert" class="text-xs text-danger-text">{{ pinError }}</p>
      <button
        type="submit"
        :disabled="pinBusy"
        class="w-full rounded-lg bg-accent py-2 text-xs font-bold text-on-accent disabled:opacity-60"
        data-testid="pdf-pin-spec-save"
      >
        {{ t.viewer.pinSpecSave }}
      </button>
    </form>

    <!-- Page canvas viewport -->
    <div class="relative overflow-auto rounded-xl bg-black/40 border border-white/5 max-h-[54vh] lg:max-h-[64vh] flex justify-center p-2">
      <div v-if="loading" class="flex h-44 w-full items-center justify-center text-xs text-muted">
        {{ t.viewer.loadingPdf }}
      </div>
      <div v-else-if="loadError" class="flex h-36 w-full items-center justify-center text-xs text-muted">
        {{ t.viewer.openPdf }}
      </div>
      <canvas
        v-show="!loading && !loadError"
        ref="canvasEl"
        class="block max-w-full h-auto shadow"
        data-testid="pdf-canvas"
      />
    </div>

    <!-- Page navigation, zoom, and external/download actions -->
    <div class="flex flex-wrap items-center gap-1.5">
      <template v-if="totalPages > 0">
        <button
          type="button"
          class="size-9 rounded-lg bg-bg border border-white/10 text-sm font-semibold disabled:opacity-40"
          :aria-label="t.viewer.prevPage"
          :disabled="currentPage <= 1"
          data-testid="pdf-prev-page"
          @click="setPage(currentPage - 1)"
        >
          ←
        </button>
        <span class="px-1.5 font-tag text-xs text-muted tabular-nums" data-testid="pdf-page-indicator">
          {{ t.viewer.pageOf(currentPage, totalPages) }}
        </span>
        <button
          type="button"
          class="size-9 rounded-lg bg-bg border border-white/10 text-sm font-semibold disabled:opacity-40"
          :aria-label="t.viewer.nextPage"
          :disabled="currentPage >= totalPages"
          data-testid="pdf-next-page"
          @click="setPage(currentPage + 1)"
        >
          →
        </button>
      </template>

      <span class="flex-1" />

      <button
        type="button"
        class="size-9 rounded-lg bg-bg border border-white/10 text-base disabled:opacity-40"
        :aria-label="t.viewer.zoomOut"
        :disabled="zoom <= 0.75"
        data-testid="pdf-zoom-out"
        @click="setZoom(zoom - 0.25)"
      >
        −
      </button>
      <button
        type="button"
        class="size-9 rounded-lg bg-bg border border-white/10 text-base disabled:opacity-40"
        :aria-label="t.viewer.zoomIn"
        :disabled="zoom >= 3"
        data-testid="pdf-zoom-in"
        @click="setZoom(zoom + 0.25)"
      >
        +
      </button>

      <a
        :href="src"
        target="_blank"
        rel="noopener"
        class="rounded-lg bg-bg border border-white/10 px-2.5 py-2 text-xs font-semibold text-accent-text hover:border-accent transition"
        :data-testid="externalTestId || 'pdf-open-external'"
      >
        {{ t.viewer.openPdf }}
      </a>
      <a
        v-if="downloadUrl"
        :href="downloadUrl"
        :download="fileName"
        class="rounded-lg bg-bg border border-white/10 px-2.5 py-2 text-xs font-semibold text-text hover:border-accent transition"
        data-testid="pdf-download-link"
      >
        {{ t.manuals.download }}
      </a>
    </div>
  </div>
</template>
