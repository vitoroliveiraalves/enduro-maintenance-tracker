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

type RatioPreset = { ratio: number; percent: number; label: string; highlight?: boolean }

const PRESETS: RatioPreset[] = [
  { ratio: 67, percent: 1.5, label: '1.5%' },
  { ratio: 60, percent: 1.67, label: '1.6%' },
  { ratio: 50, percent: 2.0, label: '2.0% ★', highlight: true },
  { ratio: 40, percent: 2.5, label: '2.5%' },
  { ratio: 33, percent: 3.0, label: '3.0%' },
  { ratio: 30, percent: 3.33, label: '3.3%' },
  { ratio: 25, percent: 4.0, label: '4.0%' },
  { ratio: 20, percent: 5.0, label: '5.0%' },
]

const mode = ref<'presets' | 'custom'>('presets')
const activeRatio = ref(props.initialRatio ?? 50)
const customPercentText = ref('2.0')
const fuelText = ref('5.0')
const saveAsDefault = ref(true)
const busy = ref(false)

watch(
  () => props.initialRatio,
  (val) => {
    if (val && val > 0) {
      activeRatio.value = val
      const pct = (100 / val).toFixed(1)
      customPercentText.value = pct
    }
  },
  { immediate: true },
)

const activePercent = computed(() => {
  if (mode.value === 'custom') {
    const parsed = parseFloat(customPercentText.value.replace(',', '.'))
    return Number.isNaN(parsed) || parsed <= 0 ? 2.0 : parsed
  }
  const found = PRESETS.find((p) => p.ratio === activeRatio.value)
  return found ? found.percent : 100 / activeRatio.value
})

const currentEffectiveRatio = computed(() => {
  if (mode.value === 'custom') {
    return Math.max(10, Math.min(100, Math.round(100 / activePercent.value)))
  }
  return activeRatio.value
})

const fuelLitres = computed(() => {
  const parsed = parseFloat(fuelText.value.replace(',', '.'))
  return Number.isNaN(parsed) || parsed <= 0 ? 0 : parsed
})

// 1% of 1000 mL = 10 mL per litre.
const mlPerLitre = computed(() => activePercent.value * 10)

const oilMl = computed(() => {
  if (fuelLitres.value <= 0) return 0
  return Math.round(fuelLitres.value * mlPerLitre.value)
})

function selectPreset(preset: RatioPreset) {
  activeRatio.value = preset.ratio
  customPercentText.value = preset.percent.toFixed(1)
}

function adjustCustomPercent(delta: number) {
  const current = parseFloat(customPercentText.value.replace(',', '.')) || 2.0
  const next = Math.max(0.5, Math.min(10.0, Math.round((current + delta) * 10) / 10))
  customPercentText.value = next.toFixed(1)
}

function adjustFuel(delta: number) {
  const next = Math.max(0.5, Math.min(50, Math.round((fuelLitres.value + delta) * 10) / 10))
  fuelText.value = next.toFixed(1)
}

function setFuel(litres: number) {
  fuelText.value = litres.toFixed(1)
}

async function confirm() {
  const ratioToSave = currentEffectiveRatio.value
  if (saveAsDefault.value) {
    busy.value = true
    try {
      await mutate(`/api/bikes/${props.bikeId}`, { premixRatio: ratioToSave }, { method: 'PATCH', queue: true })
      toast.show(t.value.premix.savedToast(ratioToSave))
    } catch {
      // Ignore or continue
    } finally {
      busy.value = false
    }
  }
  emit('saved', ratioToSave)
  open.value = false
}
</script>

<template>
  <Sheet v-model:open="open" :title="t.premix.title" testid="premix-sheet">
    <div class="space-y-4 pt-1">
      <!-- Mode Switch: Presets vs Custom % -->
      <div class="flex items-center justify-between border-b border-track pb-2">
        <label class="text-[11px] font-semibold uppercase tracking-wider text-muted font-tag">
          {{ t.premix.ratioLabel }}
        </label>
        <div class="flex rounded-md border border-track bg-bg p-0.5 font-tag text-xs">
          <button
            type="button"
            class="rounded px-2.5 py-1 transition"
            :class="mode === 'presets' ? 'bg-surface text-text font-bold' : 'text-muted hover:text-text'"
            data-testid="mode-presets"
            @click="mode = 'presets'"
          >
            {{ t.premix.presetsPill }}
          </button>
          <button
            type="button"
            class="rounded px-2.5 py-1 transition"
            :class="mode === 'custom' ? 'bg-accent text-on-accent font-bold' : 'text-muted hover:text-text'"
            data-testid="mode-custom"
            @click="mode = 'custom'"
          >
            {{ t.premix.customPill }}
          </button>
        </div>
      </div>

      <!-- Presets View -->
      <div v-if="mode === 'presets'" class="space-y-1.5">
        <div class="grid grid-cols-4 gap-1.5" role="radiogroup">
          <button
            v-for="p in PRESETS"
            :key="p.ratio"
            type="button"
            role="radio"
            :aria-checked="activeRatio === p.ratio"
            class="rounded-xl py-2 px-1 text-center transition border"
            :class="
              activeRatio === p.ratio
                ? 'bg-accent text-on-accent border-accent shadow-md'
                : 'bg-bg text-muted border-track hover:border-text hover:text-text'
            "
            :data-testid="`ratio-${p.ratio}`"
            @click="selectPreset(p)"
          >
            <span class="block text-xs font-black font-tag tracking-tight">{{ p.label }}</span>
            <span class="block text-[10px] opacity-85 font-tag">1:{{ p.ratio }}</span>
          </button>
        </div>
      </div>

      <!-- Custom % View -->
      <div v-else class="space-y-2">
        <div class="flex items-center gap-2">
          <button
            type="button"
            class="size-[50px] shrink-0 rounded-xl border border-track bg-bg text-2xl font-bold text-white transition active:scale-95 font-tag hover:bg-surface"
            data-testid="percent-minus"
            @click="adjustCustomPercent(-0.1)"
          >
            -
          </button>
          <div class="relative w-full">
            <input
              v-model="customPercentText"
              type="text"
              inputmode="decimal"
              data-testid="custom-percent-input"
              class="block w-full rounded-xl border border-track bg-bg px-3 py-3 text-center text-2xl font-bold text-white outline-none font-tag focus:ring-2 focus:ring-accent"
            >
            <span class="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm font-bold text-accent-text font-tag">%</span>
          </div>
          <button
            type="button"
            class="size-[50px] shrink-0 rounded-xl border border-track bg-bg text-2xl font-bold text-white transition active:scale-95 font-tag hover:bg-surface"
            data-testid="percent-plus"
            @click="adjustCustomPercent(0.1)"
          >
            +
          </button>
        </div>
        <div class="flex items-center justify-between px-1 text-xs font-tag text-muted">
          <span>{{ t.premix.percentLabel }}</span>
          <span class="text-text font-bold">1:{{ currentEffectiveRatio }} ({{ mlPerLitre.toFixed(1) }} mL/L)</span>
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
            class="size-[50px] shrink-0 rounded-xl border border-track bg-bg text-2xl font-bold text-white transition active:scale-95 font-tag hover:bg-surface"
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
            class="size-[50px] shrink-0 rounded-xl border border-track bg-bg text-2xl font-bold text-white transition active:scale-95 font-tag hover:bg-surface"
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
          {{ t.premix.formula(currentEffectiveRatio, mlPerLitre.toFixed(1), activePercent.toFixed(1)) }}
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
          <span>{{ t.premix.saveDefault(bikeName, currentEffectiveRatio, activePercent.toFixed(1)) }}</span>
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
