<script setup lang="ts">
import type { ChecklistItemConfig } from '~/composables/usePreRideChecklist'
import { getDefaultChecklistItems } from '~/composables/usePreRideChecklist'

const props = defineProps<{
  bikeId: string
  bikeName: string
  vehicleType?: 'motorcycle' | 'car'
}>()

const open = defineModel<boolean>('open', { default: false })

const { t } = useI18n()
const toast = useToast()
const { getEffectiveItems, saveItems, resetItems } = usePreRideChecklist(props.bikeId)

const isCar = computed(() => props.vehicleType === 'car')
const draftItems = ref<ChecklistItemConfig[]>([])

const newLabel = ref('')
const newHint = ref('')

function reloadDraft() {
  draftItems.value = JSON.parse(JSON.stringify(getEffectiveItems(isCar.value, t.value)))
}

watch(open, (isOpen) => {
  if (isOpen) {
    reloadDraft()
    newLabel.value = ''
    newHint.value = ''
  }
})

function toggleItem(id: string) {
  const item = draftItems.value.find((it) => it.id === id)
  if (item) item.enabled = !item.enabled
}

function removeItem(id: string) {
  draftItems.value = draftItems.value.filter((it) => it.id !== id)
}

function addNewCheck() {
  const label = newLabel.value.trim()
  if (!label) return
  draftItems.value.push({
    id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    label,
    hint: newHint.value.trim() || undefined,
    enabled: true,
    isCustom: true,
  })
  newLabel.value = ''
  newHint.value = ''
}

function onResetDefaults() {
  resetItems()
  draftItems.value = JSON.parse(JSON.stringify(getDefaultChecklistItems(isCar.value, t.value)))
  toast.show(t.value.checklist.resetDefaults)
}

function onSave() {
  saveItems(draftItems.value)
  toast.show(t.value.common.done)
  open.value = false
}

const activeCount = computed(() => draftItems.value.filter((it) => it.enabled).length)
</script>

<template>
  <Sheet v-model:open="open" :title="t.checklist.customizeTitle" testid="checklist-custom-sheet">
    <div class="space-y-4">
      <div class="flex items-center justify-between">
        <div>
          <p class="font-tag text-xs uppercase tracking-widest text-muted">{{ bikeName }}</p>
          <p class="text-xs text-muted mt-0.5">{{ t.checklist.customizeSubtitle }}</p>
        </div>
        <span class="rounded bg-surface px-2 py-1 font-tag text-xs font-semibold text-accent-text border border-white/10" data-testid="active-checks-count">
          {{ t.checklist.activeCount(activeCount) }}
        </span>
      </div>

      <!-- Checklist items -->
      <div class="space-y-2" data-testid="custom-items-list">
        <div
          v-for="item in draftItems"
          :key="item.id"
          class="flex items-start justify-between gap-3 rounded-xl border p-3 transition"
          :class="item.enabled ? 'border-white/10 bg-surface' : 'border-white/5 bg-surface/40 opacity-60'"
          :data-testid="`custom-item-row-${item.id}`"
        >
          <button
            type="button"
            role="switch"
            :aria-checked="item.enabled"
            class="flex flex-1 items-start gap-3 text-left"
            :data-testid="`toggle-check-${item.id}`"
            @click="toggleItem(item.id)"
          >
            <span
              class="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md border text-xs font-bold transition"
              :class="item.enabled ? 'border-accent bg-accent text-on-accent' : 'border-white/20 bg-bg text-transparent'"
            >
              ✓
            </span>
            <span class="flex-1">
              <span class="flex items-center gap-2">
                <span class="text-sm font-semibold text-white" :class="{ 'line-through text-muted': !item.enabled }">
                  {{ item.label }}
                </span>
                <span
                  v-if="item.isCustom"
                  class="rounded border border-accent/30 bg-accent/10 px-1.5 py-0.2 font-tag text-[10px] text-accent-text"
                >
                  {{ t.checklist.customTag }}
                </span>
              </span>
              <span v-if="item.hint" class="block text-xs text-muted mt-0.5 leading-normal">
                {{ item.hint }}
              </span>
            </span>
          </button>

          <button
            v-if="item.isCustom"
            type="button"
            class="size-7 flex items-center justify-center rounded-lg text-muted hover:bg-danger/20 hover:text-danger-text transition"
            :aria-label="t.checklist.deleteItem"
            :data-testid="`delete-check-${item.id}`"
            @click="removeItem(item.id)"
          >
            ✕
          </button>
        </div>
      </div>

      <!-- Add new check -->
      <div class="rounded-xl border border-white/10 bg-surface/60 p-3.5 space-y-2.5" data-testid="add-new-check-card">
        <span class="block font-tag text-xs font-bold uppercase tracking-wider text-muted">
          {{ t.checklist.addItem }}
        </span>
        <input
          v-model="newLabel"
          maxlength="80"
          :placeholder="t.checklist.itemTitlePh"
          class="block w-full rounded-xl bg-bg px-3 py-2.5 text-sm text-white outline-none focus:ring-2 focus:ring-accent"
          data-testid="new-check-title-input"
          @keydown.enter.prevent="addNewCheck"
        >
        <input
          v-model="newHint"
          maxlength="140"
          :placeholder="t.checklist.itemHintPh"
          class="block w-full rounded-xl bg-bg px-3 py-2 text-xs text-white outline-none focus:ring-2 focus:ring-accent"
          data-testid="new-check-hint-input"
          @keydown.enter.prevent="addNewCheck"
        >
        <button
          type="button"
          :disabled="!newLabel.trim()"
          class="min-h-10 w-full rounded-xl bg-bg border border-white/10 text-xs font-semibold text-accent-text hover:border-accent disabled:opacity-40 transition flex items-center justify-center gap-1.5"
          data-testid="add-check-submit"
          @click="addNewCheck"
        >
          <span>{{ t.checklist.addItem }}</span>
        </button>
      </div>

      <!-- Actions -->
      <div class="flex items-center gap-2 pt-2">
        <button
          type="button"
          class="min-h-11 px-3 rounded-xl border border-white/10 text-xs font-semibold text-muted hover:text-white hover:border-white/20 transition"
          data-testid="reset-defaults-btn"
          @click="onResetDefaults"
        >
          {{ t.checklist.resetDefaults }}
        </button>
        <button
          type="button"
          class="flex-1 min-h-11 rounded-xl bg-accent py-2.5 text-sm font-bold text-on-accent transition active:scale-[0.99]"
          data-testid="save-custom-checklist-btn"
          @click="onSave"
        >
          {{ t.common.save }}
        </button>
      </div>
    </div>
  </Sheet>
</template>
