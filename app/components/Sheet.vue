<script setup lang="ts">
const { t } = useI18n()
const props = defineProps<{ title: string; testid?: string }>()
const open = defineModel<boolean>('open', { default: false })

// Count open sheets app-wide (the mic button hides while one is open).
const { openSheets } = useSheets()
watch(open, (v, was) => { if (!!v !== !!was) openSheets.value += v ? 1 : -1 }, { immediate: true })
onBeforeUnmount(() => { if (open.value) openSheets.value-- })

const titleId = `sheet-${useId()}`
const panel = ref<HTMLElement | null>(null)
let returnTo: HTMLElement | null = null

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

watch(
  open,
  async (isOpen) => {
    if (isOpen) {
      returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null
      await nextTick()
      const first = panel.value?.querySelector<HTMLElement>('input:not([disabled]), select:not([disabled]), textarea:not([disabled])')
      ;(first ?? panel.value)?.focus({ preventScroll: true })
    } else {
      returnTo?.focus()
      returnTo = null
    }
  },
  { flush: 'post' },
)

// On-screen keyboard: lift the sheet above it (iOS Safari doesn't resize the layout viewport).
const keyboard = ref(0)
const viewH = ref(0)
function onViewport() {
  const vv = window.visualViewport
  if (!vv) return
  keyboard.value = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop))
  viewH.value = vv.height
}
function onFocusIn(e: FocusEvent) {
  const t = e.target as HTMLElement | null
  if (t?.matches('input, select, textarea')) setTimeout(() => t.scrollIntoView({ block: 'nearest' }), 250)
}
watch(open, (isOpen) => {
  const vv = typeof window !== 'undefined' ? window.visualViewport : null
  if (!vv) return
  if (isOpen) {
    onViewport()
    vv.addEventListener('resize', onViewport)
    vv.addEventListener('scroll', onViewport)
  } else {
    vv.removeEventListener('resize', onViewport)
    vv.removeEventListener('scroll', onViewport)
    keyboard.value = 0
  }
})
onBeforeUnmount(() => {
  window.visualViewport?.removeEventListener('resize', onViewport)
  window.visualViewport?.removeEventListener('scroll', onViewport)
})

// Android back (or a back swipe) closes the sheet instead of leaving the screen.
// Only history moves are caught: during a back/forward the history entry has
// already changed when the guard runs; a push from a link or after a save hasn't.
const router = useRouter()
let removeGuard: (() => void) | null = null
watch(open, (isOpen) => {
  removeGuard?.()
  removeGuard = null
  if (!isOpen) return
  const at = (window.history.state as { position?: number } | null)?.position
  removeGuard = router.beforeEach(() => {
    if (!open.value || (window.history.state as { position?: number } | null)?.position === at) return true
    open.value = false
    return false
  })
})
onBeforeUnmount(() => removeGuard?.())

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.stopPropagation()
    open.value = false
    return
  }
  if (e.key !== 'Tab' || !panel.value) return
  const nodes = [...panel.value.querySelectorAll<HTMLElement>(FOCUSABLE)]
  if (!nodes.length) return
  const first = nodes[0]!
  const last = nodes[nodes.length - 1]!
  if (e.shiftKey && (document.activeElement === first || document.activeElement === panel.value)) {
    e.preventDefault()
    last.focus()
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault()
    first.focus()
  }
}
</script>

<template>
  <Transition name="sheet">
    <div v-if="open" class="fixed inset-0 z-40 flex items-end bg-black/60 backdrop-blur-[2px]" :style="keyboard ? { paddingBottom: `${keyboard}px` } : undefined" :data-testid="props.testid ? `${props.testid}-backdrop` : undefined" @click.self="open = false">
      <div
        ref="panel"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="titleId"
        tabindex="-1"
        class="sheet-panel mx-auto max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-surface p-4 outline-none"
        :style="{
          paddingBottom: keyboard ? '1rem' : 'calc(1.5rem + env(safe-area-inset-bottom))',
          ...(keyboard && viewH ? { maxHeight: `${Math.round(viewH * 0.92)}px` } : {}),
        }"
        :data-testid="props.testid"
        @keydown="onKey"
        @focusin="onFocusIn"
      >
        <div aria-hidden="true" class="mx-auto -mt-1 mb-3 h-1 w-10 rounded-full bg-muted/30" />
        <div class="mb-3 flex items-start justify-between gap-2">
          <h2 :id="titleId" class="pt-2.5 text-base font-bold text-white">{{ props.title }}</h2>
          <button type="button" class="-mr-2 -mt-1 size-11 shrink-0 rounded-lg text-2xl leading-none text-muted active:scale-95" :aria-label="t.common.close" data-testid="sheet-close" @click="open = false">×</button>
        </div>
        <slot />
      </div>
    </div>
  </Transition>
</template>
