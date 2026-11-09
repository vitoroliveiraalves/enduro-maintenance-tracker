<script setup lang="ts">
/** The invoice's own pages: tap a page number, pinch or use +/− to zoom, drag to pan. */
const props = defineProps<{ docId: string; pages: Array<{ page: number; mime: string }> }>()

const current = ref(1)
const scale = ref(1)
const pan = ref({ x: 0, y: 0 })
const pointers = new Map<number, { x: number; y: number }>()
let pinchStart = 0
let scaleStart = 1

const page = computed(() => props.pages.find((p) => p.page === current.value) ?? props.pages[0])
const src = (n: number) => `/api/documents/${props.docId}/files/${n}`
const clamp = (v: number) => Math.min(5, Math.max(1, v))
const dist = () => {
  const [a, b] = [...pointers.values()]
  return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0
}

function setScale(v: number) {
  scale.value = clamp(v)
  if (scale.value === 1) pan.value = { x: 0, y: 0 }
}
function show(n: number) {
  current.value = n
  setScale(1)
}
function down(e: PointerEvent) {
  ;(e.currentTarget as Element).setPointerCapture?.(e.pointerId)
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
  if (pointers.size === 2) {
    pinchStart = dist()
    scaleStart = scale.value
  }
}
function move(e: PointerEvent) {
  const prev = pointers.get(e.pointerId)
  if (!prev) return
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
  if (pointers.size === 2 && pinchStart > 0) setScale((scaleStart * dist()) / pinchStart)
  else if (pointers.size === 1 && scale.value > 1) pan.value = { x: pan.value.x + e.clientX - prev.x, y: pan.value.y + e.clientY - prev.y }
}
function up(e: PointerEvent) {
  pointers.delete(e.pointerId)
  if (pointers.size < 2) pinchStart = 0
}
</script>

<template>
  <section class="rounded-2xl bg-surface p-2" data-testid="invoice-viewer">
    <div
      v-if="page && page.mime.startsWith('image/')"
      class="relative h-[44vh] overflow-hidden rounded-xl bg-black/40"
      :style="{ touchAction: scale > 1 ? 'none' : 'pan-y' }"
      @pointerdown="down"
      @pointermove="move"
      @pointerup="up"
      @pointercancel="up"
      @dblclick="setScale(scale > 1 ? 1 : 2.5)"
    >
      <img
        :src="src(page.page)"
        :alt="`Invoice page ${page.page}`"
        draggable="false"
        class="h-full w-full select-none object-contain"
        :style="{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})` }"
        data-testid="viewer-image"
      >
    </div>
    <a
      v-else-if="page"
      :href="src(page.page)"
      target="_blank"
      rel="noopener"
      class="flex h-40 items-center justify-center rounded-xl bg-black/40 font-semibold text-accent"
      data-testid="viewer-pdf"
    >
      Open the PDF ↗
    </a>
    <div class="mt-2 flex items-center gap-1.5">
      <button
        v-for="p in pages"
        v-show="pages.length > 1"
        :key="p.page"
        type="button"
        class="size-9 rounded-lg text-sm font-semibold"
        :class="p.page === current ? 'bg-accent text-on-accent' : 'bg-bg text-muted'"
        :aria-label="`Page ${p.page}`"
        :aria-current="p.page === current ? 'true' : undefined"
        @click="show(p.page)"
      >
        {{ p.page }}
      </button>
      <span class="flex-1" />
      <template v-if="page?.mime.startsWith('image/')">
        <button type="button" class="size-9 rounded-lg bg-bg text-lg" aria-label="Zoom out" :disabled="scale <= 1" @click="setScale(scale - 0.75)">−</button>
        <button type="button" class="size-9 rounded-lg bg-bg text-lg" aria-label="Zoom in" :disabled="scale >= 5" @click="setScale(scale + 0.75)">+</button>
      </template>
    </div>
  </section>
</template>
