<script setup lang="ts">
const props = defineProps<{ title: string; testid?: string }>()
const open = defineModel<boolean>('open', { default: false })

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
      ;(first ?? panel.value)?.focus()
    } else {
      returnTo?.focus()
      returnTo = null
    }
  },
  { flush: 'post' },
)

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
  <div v-if="open" class="fixed inset-0 z-40 flex items-end bg-black/60" :data-testid="props.testid ? `${props.testid}-backdrop` : undefined" @click.self="open = false">
    <div
      ref="panel"
      role="dialog"
      aria-modal="true"
      :aria-labelledby="titleId"
      tabindex="-1"
      class="mx-auto max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-surface p-4 pb-6 outline-none"
      :data-testid="props.testid"
      @keydown="onKey"
    >
      <h2 :id="titleId" class="mb-3 text-base font-bold text-white">{{ props.title }}</h2>
      <slot />
    </div>
  </div>
</template>
