<script setup lang="ts">
const { t } = useI18n()
const { mutate } = useApi()
const toast = useToast()

const props = defineProps<{
  bikeId: string
  bikeName: string
  initialRatio?: number | null
}>()

const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ saved: [ratio: number] }>()

const RATIOS = [
  { ratio: 40, percent: '2.5%' },
  { ratio: 50, percent: '2.0% ★' },
  { ratio: 60, percent: '1.6%' },
  { ratio: 30, percent: '3.3%' },
]

const selectedRatio = ref(props.initialRatio ?? 50)
const fuelText = ref('5.0')
const saveAsDefault = ref(true)
const busy = ref(false)

watch(
  () => props.initialRatio,
  (val) => {
    if (val) selectedRatio.value = val
  },
  { immediate: true },
)

const fuelLitres = computed(() => {
  const parsed = parseFloat(fuelText.value.replace(',', '.'))
  return Number.isNaN(parsed) || parsed <= 0 ? 0 : parsed
})

const mlPerLitre = computed(() => 1000 / selectedRatio.value)

const oilMl = computed(() => {
  if (fuelLitres.value <= 0) return 0
  return Math.round(fuelLitres.value * mlPerLitre.value)
})

function adjustFuel(delta: number) {
  const next = Math.max(0.5, Math.min(50, Math.round((fuelLitres.value + delta) * 10) / 10))
  fuelText.value = next.toFixed(1)
}

function setFuel(litres: number) {
  fuelText.value = litres.toFixed(1)
}

async function confirm() {
  if (saveAsDefault.value) {
    busy.value = true
    try {
      await mutate(`/api/bikes/${props.bikeId}`, { premixRatio: selectedRatio.value }, { method: 'PATCH', queue: true })
      toast.show(t.value.premix.savedToast(selectedRatio.value))
    } catch {
      // Ignore or continue
    } finally {
      busy.value = false
    }
  }
  emit('saved', selectedRatio.value)
  open.value = false
}
</script>

<template>
  <Sheet v-model:open="open" :title="t.premix.title" testid="premix-sheet">
    <div class="space-y-4 pt-1">
      <!-- Ratio Selector -->
      <div>
        <label class="mb-2 block text-[11px] font-semibold uppercase tracking-wider text-muted font-tag">
          {{ t.premix.ratioLabel }}
        </label>
        <div class="grid grid-cols-4 gap-1.5" role="radiogroup">
          <button
            v-for="r in RATIOS"
            :key="r.ratio"
            type="button"
            role="radio"
            :aria-checked="selectedRatio === r.ratio"
            class="rounded-full py-2 text-center text-xs font-semibold transition"
            :class="selectedRatio === r.ratio ? 'bg-accent text-on-accent shadow-md' : 'bg-bg text-muted border border-track'"
            :data-testid="`ratio-${r.ratio}`"
            @click="selectedRatio = r.ratio"
          >
            <span class="block font-bold font-tag">1:{{ r.ratio }}</span>
            <span class="block text-[10px] opacity-85">{{ r.percent }}</span>
          </button>
        </div>
      </div>

      <!-- Fuel Volume Input -->
      <div>
        <div class="mb-1 flex items-baseline justify-between">
          <label class="text-[11px] font-semibold uppercase tracking-wider text-muted font-tag">
            {{ t.premix.fuelVolume }}
          </label>
          <span class="text-xs font-tag text-accent-text">{{ fuelText }} {{ t.premix.litres }}</span>
        </div>

        <div class="flex items-center gap-2">
          <button
            type="button"
            class="size-[54px] shrink-0 rounded-xl border border-track bg-bg text-2xl font-bold text-white transition active:scale-95 font-tag hover:bg-surface"
            data-testid="fuel-minus"
            @click="adjustFuel(-0.5)"
          >
            -
          </button>
          <input
            v-model="fuelText"
            type="text"
            inputmode="decimal"
            data-testid="fuel-input"
            class="block w-full rounded-xl border border-track bg-bg px-3 py-3 text-center text-2xl font-bold text-white outline-none font-tag focus:ring-2 focus:ring-accent"
          >
          <button
            type="button"
            class="size-[54px] shrink-0 rounded-xl border border-track bg-bg text-2xl font-bold text-white transition active:scale-95 font-tag hover:bg-surface"
            data-testid="fuel-plus"
            @click="adjustFuel(0.5)"
          >
            +
          </button>
        </div>

        <!-- Quick Jerrycan Buttons -->
        <div class="mt-2.5 flex flex-wrap gap-1.5">
          <button
            v-for="j in [5, 10, 15, 20]"
            :key="j"
            type="button"
            class="rounded-full border border-track bg-bg px-2.5 py-1 text-xs font-tag text-text hover:border-text transition"
            :data-testid="`jerrycan-${j}`"
            @click="setFuel(j)"
          >
            {{ j }} L
          </button>
          <button
            type="button"
            class="rounded-full border border-warn text-warn-text bg-bg px-2.5 py-1 text-xs font-tag font-semibold hover:border-text transition"
            data-testid="jerrycan-tank"
            @click="setFuel(8.5)"
          >
            {{ t.premix.tank }} (8.5 L)
          </button>
        </div>
      </div>

      <!-- Oil Readout Display -->
      <div class="border-[1.5px] border-text bg-bg p-4 text-center font-tag">
        <div class="mb-1 text-[10px] uppercase tracking-[0.14em] text-muted">
          {{ t.premix.oilToAdd }}
        </div>
        <div class="flex items-baseline justify-center gap-1.5">
          <span class="text-5xl font-black tracking-tight text-white" data-testid="oil-amount">{{ oilMl }}</span>
          <span class="text-xl font-bold text-accent-text">mL</span>
        </div>
        <div class="mt-1 text-xs text-muted">
          {{ t.premix.formula(selectedRatio, mlPerLitre.toFixed(1)) }}
        </div>
      </div>

      <!-- Checkbox to remember ratio -->
      <div class="flex items-center justify-between text-xs text-muted">
        <label class="flex items-center gap-2 cursor-pointer">
          <input
            v-model="saveAsDefault"
            type="checkbox"
            data-testid="save-default-checkbox"
            class="size-4 rounded border-track bg-bg accent-accent"
          >
          <span>{{ t.premix.saveDefault(bikeName, selectedRatio) }}</span>
        </label>
      </div>

      <!-- Confirm Button -->
      <button
        type="button"
        :disabled="busy"
        class="brand-slant block min-h-[52px] w-full bg-accent p-[11px] font-black uppercase tracking-[0.04em] text-on-accent shadow-lg transition active:scale-[0.98] disabled:opacity-50"
        style="font-stretch: 125%; font-style: italic;"
        data-testid="confirm-premix-btn"
        @click="confirm"
      >
        {{ t.premix.confirm }}
      </button>
    </div>
  </Sheet>
</template>
