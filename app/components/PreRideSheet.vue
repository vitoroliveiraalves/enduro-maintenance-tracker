<script setup lang="ts">
const props = defineProps<{
  bikeId: string
  bikeName: string
  vehicleType?: 'motorcycle' | 'car'
}>()

const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ (e: 'completed'): void }>()

const { t } = useI18n()
const toast = useToast()
const { markChecked, getEffectiveItems } = usePreRideChecklist(props.bikeId)

const isCar = computed(() => props.vehicleType === 'car')

const items = computed(() => {
  return getEffectiveItems(isCar.value, t.value).filter((it) => it.enabled)
})

const checked = ref<Set<string>>(new Set())

watch(open, (isOpen) => {
  if (isOpen) {
    checked.value = new Set()
  }
})

function toggle(id: string) {
  const next = new Set(checked.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  checked.value = next
}

const allDone = computed(() => checked.value.size === items.value.length)

function completeAll() {
  markChecked()
  emit('completed')
  toast.show(t.value.checklist.completedToast)
  open.value = false
}
</script>

<template>
  <Sheet v-model:open="open" :title="t.checklist.title" testid="preride-sheet">
    <div class="space-y-4">
      <div>
        <div class="flex items-center justify-between">
          <p class="font-tag text-xs uppercase tracking-widest text-muted">{{ bikeName }}</p>
          <span class="font-tag text-xs font-semibold text-muted" data-testid="checklist-progress">
            {{ t.checklist.progress(checked.size, items.length) }}
          </span>
        </div>
        <p class="text-xs text-muted mt-0.5">{{ t.checklist.subtitle }}</p>
      </div>

      <div class="space-y-2" data-testid="checklist-items">
        <button
          v-for="item in items"
          :key="item.id"
          type="button"
          role="checkbox"
          :aria-checked="checked.has(item.id)"
          :data-testid="`check-item-${item.id}`"
          class="w-full flex items-start gap-3 rounded-xl border p-3 text-left transition"
          :class="checked.has(item.id) ? 'border-accent/40 bg-surface/90' : 'border-white/5 bg-surface/50 hover:border-white/20'"
          @click="toggle(item.id)"
        >
          <span
            class="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md border text-xs font-bold transition"
            :class="checked.has(item.id) ? 'border-accent bg-accent text-on-accent' : 'border-white/20 bg-bg text-transparent'"
          >
            ✓
          </span>
          <span class="flex-1">
            <span class="block text-sm font-semibold text-text" :class="{ 'line-through text-muted': checked.has(item.id) }">
              {{ item.label }}
            </span>
            <span class="block text-xs text-muted mt-0.5 leading-normal">
              {{ item.hint }}
            </span>
          </span>
        </button>
      </div>

      <div class="pt-2">
        <button
          type="button"
          class="min-h-12 w-full rounded-xl bg-accent py-3 text-sm font-bold text-on-accent transition active:scale-[0.99] flex items-center justify-center gap-2"
          data-testid="checklist-done-btn"
          @click="completeAll"
        >
          <span>{{ allDone ? t.checklist.allGood : t.checklist.markAllGood }}</span>
        </button>
      </div>
    </div>
  </Sheet>
</template>
