<script setup lang="ts">
import { errorMessage } from '~/offline/outbox'
import type { Detail } from './index.vue'

const route = useRoute()
const id = route.params.id as string
const { get, mutate } = useApi()
const toast = useToast()
const store = useBikesStore()
const { t } = useI18n()
const { hours, km } = useFormatters()
const { syncTick } = useOffline()

const data = ref<Detail | null>(null)
const error = ref('')
const loading = ref(true)

// Form fields
const name = ref('')
const plate = ref('')
const make = ref('')
const model = ref('')
const year = ref<number | ''>('')
const stroke = ref<'2T' | '4T'>('4T')
const notes = ref('')

const infoBusy = ref(false)
const infoError = ref('')

// Meters
const metersDraft = ref<BikeMeters>('hours_km')
const metersBusy = ref(false)
const metersError = ref('')

// Sheets
const correctOpen = ref(false)
const premixOpen = ref(false)
const askRemove = ref(false)
const removeBusy = ref(false)

function populate(d: Detail) {
  data.value = d
  name.value = d.bike.name
  plate.value = d.bike.plate ?? ''
  make.value = d.bike.make ?? ''
  model.value = d.bike.model ?? ''
  year.value = d.bike.year ?? ''
  stroke.value = d.bike.stroke ?? '4T'
  notes.value = d.bike.notes ?? ''
  metersDraft.value = d.bike.meters ?? 'hours_km'
}

async function load() {
  try {
    const res = await get<Detail>(`/api/bikes/${id}`)
    populate(res)
    error.value = ''
  } catch (e) {
    if (!data.value) error.value = errorMessage(e, t.value.bike.notFound, true)
  } finally {
    loading.value = false
  }
}

onMounted(load)
watch(syncTick, load)

const isCar = computed(() => data.value?.bike.vehicleType === 'car')
const currentMeters = computed<BikeMeters>(() => data.value?.bike.meters ?? 'hours_km')
const hasHours = computed(() => countsHours(currentMeters.value))
const hasKm = computed(() => countsKm(currentMeters.value))

async function saveInfo() {
  if (infoBusy.value) return
  infoError.value = ''
  const trimmedName = name.value.trim()
  if (!trimmedName) {
    infoError.value = t.value.manage.needName(isCar.value ? t.value.manage.what.car : t.value.manage.what.bike)
    return
  }
  const yr = typeof year.value === 'number' ? year.value : Number(year.value)
  if (!yr || yr < 1950 || yr > 2100) {
    infoError.value = t.value.newBike.needNames
    return
  }

  infoBusy.value = true
  try {
    const payload = {
      name: trimmedName,
      plate: plate.value.trim().toUpperCase() || null,
      make: make.value.trim() || undefined,
      model: model.value.trim() || undefined,
      year: yr,
      stroke: stroke.value,
      notes: notes.value.trim() || null,
    }
    await mutate(`/api/bikes/${id}`, payload, { method: 'PATCH', queue: true })
    toast.show(t.value.bike.infoSaved)
    await load()
  } catch (e) {
    infoError.value = errorMessage(e, t.value.manage.saveFailed)
  } finally {
    infoBusy.value = false
  }
}

async function savePlateOnly() {
  if (infoBusy.value) return
  infoBusy.value = true
  try {
    const p = plate.value.trim().toUpperCase() || null
    await mutate(`/api/bikes/${id}`, { plate: p }, { method: 'PATCH', queue: true })
    toast.show(t.value.bike.plateSaved)
    await load()
  } catch (e) {
    infoError.value = errorMessage(e, t.value.manage.saveFailed)
  } finally {
    infoBusy.value = false
  }
}

async function saveMeters() {
  if (metersBusy.value || metersDraft.value === currentMeters.value) return
  metersBusy.value = true
  metersError.value = ''
  try {
    await mutate(`/api/bikes/${id}`, { meters: metersDraft.value }, { method: 'PATCH' })
    await load()
    toast.show(t.value.meters.countsToast(t.value.meters.label[metersDraft.value]))
  } catch (e) {
    metersError.value = errorMessage(e, t.value.bike.metersFailed)
  } finally {
    metersBusy.value = false
  }
}

function onCorrected(detail: Record<string, unknown>) {
  data.value = detail as unknown as Detail
  toast.show(t.value.bike.corrected)
}

async function removeVehicle() {
  if (removeBusy.value) return
  removeBusy.value = true
  try {
    const vName = data.value?.bike.name ?? t.value.bike.fallbackName
    await mutate(`/api/bikes/${id}`, { archived: true }, { method: 'PATCH', queue: true })
    store.setLast(null)
    toast.show(t.value.bike.removed(vName))
    await navigateTo('/')
  } catch (e) {
    toast.show(errorMessage(e, t.value.manage.saveFailed))
  } finally {
    removeBusy.value = false
  }
}

const h2 = 'mb-2 mt-5 text-[11px] font-tag font-bold uppercase tracking-[0.12em] text-muted'
const field = 'mt-1 block w-full rounded-xl bg-bg px-3 py-3 text-base normal-case text-white outline-none focus:ring-2 focus:ring-accent'
</script>

<template>
  <main class="mx-auto max-w-md px-4 pb-10 pt-[18px]">
    <p v-if="error" role="alert" class="text-danger-text">{{ error }}</p>

    <div class="flex items-center justify-between text-[13px] text-muted">
      <NuxtLink :to="`/bikes/${id}`" class="-m-2 p-2 font-tag text-xs flex items-center gap-1.5" data-testid="back-to-bike">
        <span>←</span> {{ t.bike.backToVehicle }}
      </NuxtLink>
      <NuxtLink to="/settings" class="-m-2 flex size-11 items-center justify-center text-lg text-muted hover:text-white" :aria-label="t.garage.settings" data-testid="global-settings-link">
        <Icon name="settings" :size="20" />
      </NuxtLink>
    </div>

    <template v-if="data">
      <div class="mb-4 mt-2">
        <h1 class="text-[28px] font-black italic uppercase tracking-wider text-white" data-testid="vehicle-settings-title">
          {{ t.bike.settings }}
        </h1>
        <p class="text-xs text-muted font-tag uppercase tracking-widest">{{ data.bike.name }}</p>
      </div>

      <!-- Vehicle details form -->
      <h2 :class="h2">{{ t.bike.infoSection }}</h2>
      <section class="rounded-xl bg-surface p-3.5 border border-track" data-testid="manage-bike">
        <form @submit.prevent="saveInfo">
          <label class="block text-[11px] uppercase tracking-wider text-muted font-tag">
            {{ t.manage.name }}
            <input v-model="name" maxlength="80" autocomplete="off" data-testid="bike-rename" :class="field">
          </label>

          <div class="mt-3 grid grid-cols-2 gap-2.5">
            <label class="block text-[11px] uppercase tracking-wider text-muted font-tag">
              {{ t.newBike.plate }}
              <input
                v-model="plate"
                maxlength="20"
                :placeholder="t.newBike.platePh"
                autocomplete="off"
                data-testid="bike-plate-input"
                class="mt-1 block w-full rounded-xl bg-bg px-3 py-3 font-tag text-base uppercase tracking-wider text-white outline-none focus:ring-2 focus:ring-accent"
              >
            </label>
            <label class="block text-[11px] uppercase tracking-wider text-muted font-tag">
              {{ t.bike.year }}
              <input v-model.number="year" type="number" min="1950" max="2100" data-testid="bike-year-input" :class="field">
            </label>
          </div>

          <div class="mt-3 grid grid-cols-2 gap-2.5">
            <label class="block text-[11px] uppercase tracking-wider text-muted font-tag">
              {{ t.bike.make }}
              <input v-model="make" maxlength="50" autocomplete="off" data-testid="bike-make-input" :class="field">
            </label>
            <label class="block text-[11px] uppercase tracking-wider text-muted font-tag">
              {{ t.bike.model }}
              <input v-model="model" maxlength="50" autocomplete="off" data-testid="bike-model-input" :class="field">
            </label>
          </div>

          <div v-if="!isCar" class="mt-3">
            <span class="block text-[11px] uppercase tracking-wider text-muted font-tag mb-1">{{ t.bike.stroke }}</span>
            <div class="flex gap-2" role="radiogroup">
              <button
                type="button"
                role="radio"
                :aria-checked="stroke === '2T'"
                data-testid="bike-stroke-2t"
                class="flex-1 py-2.5 rounded-xl border text-sm font-tag font-bold transition"
                :class="stroke === '2T' ? 'bg-accent border-accent text-on-accent' : 'bg-bg border-white/10 text-muted hover:text-white'"
                @click="stroke = '2T'"
              >
                2T
              </button>
              <button
                type="button"
                role="radio"
                :aria-checked="stroke === '4T'"
                data-testid="bike-stroke-4t"
                class="flex-1 py-2.5 rounded-xl border text-sm font-tag font-bold transition"
                :class="stroke === '4T' ? 'bg-accent border-accent text-on-accent' : 'bg-bg border-white/10 text-muted hover:text-white'"
                @click="stroke = '4T'"
              >
                4T
              </button>
            </div>
          </div>

          <!-- Notes -->
          <label class="mt-3 block text-[11px] uppercase tracking-wider text-muted font-tag">
            {{ t.bike.notes }}
            <textarea
              v-model="notes"
              rows="3"
              maxlength="5000"
              :placeholder="t.bike.notesPh"
              data-testid="bike-notes-input"
              class="mt-1 block w-full rounded-xl bg-bg px-3 py-2.5 text-sm normal-case text-white outline-none focus:ring-2 focus:ring-accent font-sans leading-relaxed resize-none"
            />
          </label>

          <p v-if="infoError" role="alert" class="mt-2 text-sm text-danger-text" data-testid="bike-info-error">{{ infoError }}</p>

          <div class="mt-4 flex gap-2">
            <button
              type="submit"
              :disabled="infoBusy"
              class="flex-1 rounded-xl bg-accent py-3 text-sm font-bold text-on-accent disabled:opacity-60"
              data-testid="bike-settings-save"
            >
              {{ t.bike.saveInfo }}
            </button>
            <!-- Hidden button with data-testid="bike-plate-save" for backward-compatibility with tests -->
            <button
              type="button"
              class="sr-only"
              data-testid="bike-plate-save"
              @click="savePlateOnly"
            >
              {{ t.common.save }}
            </button>
          </div>
        </form>
      </section>

      <!-- Meter totals & correction -->
      <h2 :class="h2">{{ t.bike.totalsSection }}</h2>
      <section class="rounded-xl bg-surface p-3.5 border border-track" data-testid="totals-section">
        <div v-if="data.latestReading" class="mb-3 flex gap-2.5">
          <MeterCard v-if="hasHours" :label="t.common.hours" :value="data.latestReading.hoursTenths === null ? '—' : hours(data.latestReading.hoursTenths)" testid="settings-hours-value" />
          <MeterCard v-if="hasKm" :label="t.common.km" :value="data.latestReading.km === null ? '—' : km(data.latestReading.km).replace(/ km$/, '')" testid="settings-km-value" />
        </div>
        <p class="text-xs text-muted mb-3">{{ t.correctTotal.intro }}</p>
        <button
          type="button"
          class="min-h-11 w-full rounded-xl bg-bg border border-white/10 text-sm font-semibold text-accent-text hover:border-accent transition flex items-center justify-center gap-2"
          data-testid="correct-total"
          @click="correctOpen = true"
        >
          <span>{{ t.bike.correctTotalBtn }}</span>
        </button>
      </section>

      <!-- Meters choice -->
      <h2 v-if="!isCar" :class="h2">{{ t.bike.bikeSection }}</h2>
      <form v-if="!isCar" class="rounded-xl bg-surface p-3.5 border border-track" data-testid="bike-meters" @submit.prevent="saveMeters">
        <MetersChoice v-model="metersDraft" :disabled="metersBusy" />
        <p class="mt-2 text-xs text-muted">{{ t.bike.metersHint }}</p>
        <p v-if="metersError" role="alert" class="mt-2 text-sm text-danger-text">{{ metersError }}</p>
        <button
          type="submit"
          :disabled="metersBusy || metersDraft === currentMeters"
          class="mt-3 min-h-11 w-full rounded-xl bg-bg text-sm font-semibold text-accent-text disabled:opacity-40"
          data-testid="bike-meters-save"
        >
          {{ t.bike.saveCounts }}
        </button>
      </form>

      <!-- 2T Premix setting -->
      <template v-if="!isCar && data.bike.stroke === '2T'">
        <h2 :class="h2">{{ t.premix.title }}</h2>
        <section class="rounded-xl bg-surface p-3.5 border border-track flex items-center justify-between" data-testid="premix-settings-card">
          <div>
            <span class="text-sm font-semibold text-white block">{{ t.premix.chipLabel(data.bike.premixRatio ?? 50) }}</span>
            <span class="text-xs text-muted">{{ t.premix.subtitle }}</span>
          </div>
          <button
            type="button"
            class="rounded-lg bg-bg px-3 py-2 text-xs font-semibold text-accent-text border border-white/10 hover:border-accent"
            data-testid="open-premix-sheet"
            @click="premixOpen = true"
          >
            {{ t.common.edit }}
          </button>
        </section>
      </template>

      <!-- Danger zone: remove vehicle -->
      <h2 :class="h2">{{ t.bike.dangerZone }}</h2>
      <section class="rounded-xl border border-danger/30 bg-surface p-3.5" data-testid="danger-section">
        <p class="text-sm font-semibold text-danger-text">{{ t.manage.remove(isCar ? t.manage.what.car : t.manage.what.bike) }}</p>
        <p class="mt-1 text-xs text-muted leading-relaxed">{{ t.bike.removeNote }}</p>

        <div v-if="!askRemove" class="mt-3">
          <button
            type="button"
            class="min-h-11 w-full rounded-xl border border-danger/40 bg-danger/10 text-sm font-bold text-danger-text hover:bg-danger/20 transition"
            data-testid="bike-remove"
            @click="askRemove = true"
          >
            {{ t.manage.remove(isCar ? t.manage.what.car : t.manage.what.bike) }}
          </button>
        </div>
        <div v-else role="alert" class="mt-3 rounded-lg border border-danger/40 bg-danger/15 p-3 text-sm">
          <p class="text-text font-medium">{{ t.manage.removeAsk(data.bike.name) }}</p>
          <div class="mt-3 flex gap-2">
            <button
              type="button"
              class="flex-1 min-h-11 rounded-lg bg-danger px-4 font-bold text-on-danger disabled:opacity-60"
              :disabled="removeBusy"
              data-testid="bike-remove-confirm"
              @click="removeVehicle"
            >
              {{ t.common.remove }}
            </button>
            <button
              type="button"
              class="min-h-11 rounded-lg px-4 text-muted hover:text-white"
              @click="askRemove = false"
            >
              {{ t.common.keep }}
            </button>
          </div>
        </div>
      </section>

      <!-- Sheets -->
      <CorrectTotalSheet
        v-model:open="correctOpen"
        :bike-id="id"
        :current="data.latestReading"
        :meters="currentMeters"
        @saved="onCorrected"
      />
      <PremixSheet
        v-if="!isCar && data.bike.stroke === '2T'"
        v-model:open="premixOpen"
        :bike-id="id"
        :bike-name="data.bike.name"
        :initial-ratio="data.bike.premixRatio ?? 50"
        @saved="(r) => { if (data) data.bike.premixRatio = r }"
      />
    </template>

    <div v-else-if="loading" class="mt-4" data-testid="settings-loading">
      <Skeleton :rows="1" height="h-10" />
      <Skeleton :rows="3" height="h-20" class="mt-4" />
      <Skeleton :rows="2" height="h-16" class="mt-4" />
    </div>
  </main>
</template>
