<script setup lang="ts">
import { categoryLabel } from '~/lib/server-text'
import { cardTitle, fillMeters, metersOf, type CardCtx, type Draft } from '~/lib/voice-cards'
const { t } = useI18n()

const d = defineModel<Draft>({ required: true })
const props = defineProps<{ ctx: CardCtx; items: Record<string, Array<{ id: string; name: string }>> }>()
defineEmits<{ remove: [] }>()

const m = computed(() => metersOf(d.value, props.ctx))
const bikeName = (id: string) => props.ctx.bikes.find((b) => b.id === id)?.name ?? t.value.card.unknownBike
const partName = (id: string) => props.ctx.parts.find((p) => p.id === id)?.name ?? t.value.card.unknownPart
const catName = (id: string) => {
  const name = props.ctx.categories.find((c) => c.id === id)?.name
  return name ? categoryLabel(name) : t.value.card.unknown
}
const bikeItems = computed(() => {
  const all = props.items[d.value.bikeId] ?? []
  return d.value.itemChoices ? all.filter((i) => d.value.itemChoices!.includes(i.id)) : all
})
const done = computed(() => d.value.status === 'saved')

function pickBike(id: string) {
  d.value.bikeId = id
  d.value.itemIds = d.value.itemIds.filter((i) => (props.items[id] ?? []).some((x) => x.id === i))
  if (d.value.kind === 'reading' || d.value.kind === 'correct_total') fillMeters(d.value, props.ctx)
}
function toggleItem(id: string, on: boolean) {
  d.value.itemIds = on ? [...new Set([...d.value.itemIds, id])] : d.value.itemIds.filter((x) => x !== id)
}

const field = 'mt-1 w-full rounded-lg border border-white/10 bg-bg px-2.5 py-2 text-base text-text outline-none focus:border-accent disabled:opacity-60'
const label = 'block text-xs text-muted'
</script>

<template>
  <li class="rounded-xl bg-bg p-3" data-testid="voice-card">
    <div class="flex items-start justify-between gap-2">
      <p class="pt-2 text-sm font-bold text-white">{{ cardTitle(d.kind) }}</p>
      <span v-if="d.status === 'saved'" class="pt-2 text-sm font-semibold text-ok-text" data-testid="card-status">{{ t.card.saved }}</span>
      <button v-else type="button" class="-mr-2 size-11 shrink-0 text-2xl leading-none text-muted" :aria-label="t.card.remove" data-testid="card-remove" :disabled="d.status === 'saving'" @click="$emit('remove')">×</button>
    </div>

    <fieldset :disabled="done || d.status === 'saving'" class="mt-1 space-y-2.5">
      <!-- Bike: a picker when the note didn't say which; optional on shelf, shopping, expense, reminder. -->
      <label v-if="d.bikeChoices" :class="label">{{ t.card.bike }}
        <select :value="d.bikeId" :class="field" data-testid="card-bike" @change="pickBike(($event.target as HTMLSelectElement).value)">
          <option value="" disabled>{{ t.card.chooseBike }}</option>
          <option v-for="id in d.bikeChoices" :key="id" :value="id">{{ bikeName(id) }}</option>
        </select>
      </label>
      <p v-else-if="d.bikeId && ['reading', 'correct_total', 'service'].includes(d.kind)" class="text-xs text-muted">{{ bikeName(d.bikeId) }}</p>

      <template v-if="d.kind === 'service'">
        <div v-if="d.bikeId">
          <p :class="label">{{ d.itemChoices ? t.card.whichOne : t.card.done }}</p>
          <label v-for="i in bikeItems" :key="i.id" class="flex min-h-11 items-center gap-2.5 text-sm text-white">
            <input type="checkbox" class="size-5 accent-accent" :checked="d.itemIds.includes(i.id)" @change="toggleItem(i.id, ($event.target as HTMLInputElement).checked)">{{ i.name }}
          </label>
        </div>
        <label :class="label">{{ t.common.date }}<input v-model="d.at" type="date" :class="field" data-testid="card-at"></label>
      </template>

      <div v-if="['reading', 'correct_total', 'service'].includes(d.kind) && d.bikeId" class="grid gap-2" :class="countsHours(m) && countsKm(m) ? 'grid-cols-2' : 'grid-cols-1'">
        <label v-if="countsHours(m)" :class="label">{{ t.common.hours }}<input v-model="d.hours" inputmode="decimal" :class="field" data-testid="card-hours"></label>
        <label v-if="countsKm(m)" :class="label">{{ t.common.km }}<input v-model="d.km" inputmode="numeric" :class="field" data-testid="card-km"></label>
      </div>

      <template v-if="d.kind === 'service'">
        <div class="flex gap-2">
          <button v-for="b in (['diy', 'garage'] as const)" :key="b" type="button" class="min-h-11 flex-1 rounded-lg border text-sm" :class="d.by === b ? 'border-accent text-accent-text' : 'border-white/10 text-muted'" @click="d.by = b">
            {{ b === 'diy' ? t.common.diy : t.card.garage }}
          </button>
        </div>
        <label v-if="d.by === 'garage'" :class="label">{{ t.card.garage }}<input v-model="d.garageName" :class="field"></label>
        <ul v-if="d.partsUsed.length" class="space-y-1.5">
          <li v-for="(l, i) in d.partsUsed" :key="l.clientId" class="flex items-center gap-2 text-sm text-white">
            <span class="min-w-0 flex-1 truncate">{{ partName(l.partId) }}</span>
            <input v-model="l.qty" inputmode="decimal" :aria-label="t.card.partUsed(partName(l.partId))" class="w-16 rounded-lg border border-white/10 bg-surface px-2 py-1.5 text-base">
            <button type="button" class="size-11 text-xl text-muted" :aria-label="t.card.dontUse(partName(l.partId))" @click="d.partsUsed.splice(i, 1)">×</button>
          </li>
        </ul>
        <label :class="label">{{ t.common.notes }}<input v-model="d.notes" :class="field"></label>
      </template>

      <template v-if="d.kind === 'use_part'">
        <label v-if="d.partChoices" :class="label">{{ t.card.part }}
          <select v-model="d.partId" :class="field" data-testid="card-part">
            <option value="" disabled>{{ t.card.choosePart }}</option>
            <option v-for="id in d.partChoices" :key="id" :value="id">{{ partName(id) }}</option>
          </select>
        </label>
        <p v-else class="text-sm text-white">{{ partName(d.partId) }}</p>
        <label :class="label">{{ t.card.howMany }}<input v-model="d.qty" inputmode="decimal" :class="field" data-testid="card-qty"></label>
      </template>

      <template v-if="d.kind === 'add_part'">
        <label :class="label">{{ t.card.part }}<input v-model="d.name" :class="field" data-testid="card-name"></label>
        <div class="grid grid-cols-2 gap-2">
          <label :class="label">{{ t.card.howMany }}<input v-model="d.qty" inputmode="decimal" :class="field" data-testid="card-qty"></label>
          <label :class="label">{{ t.card.unit }}<input v-model="d.unit" :class="field"></label>
        </div>
      </template>

      <label v-if="d.kind === 'shopping'" :class="label">{{ t.card.toBuy }}<input v-model="d.text" :class="field" data-testid="card-text"></label>

      <template v-if="d.kind === 'expense'">
        <div class="grid grid-cols-2 gap-2">
          <label :class="label">{{ t.card.amount }}<input v-model="d.amount" inputmode="decimal" :class="field" data-testid="card-amount"></label>
          <label :class="label">{{ t.common.date }}<input v-model="d.at" type="date" :class="field"></label>
        </div>
        <label :class="label">{{ t.card.category }}
          <select v-model="d.categoryId" :class="field" data-testid="card-category">
            <option value="" disabled>{{ t.card.chooseCategory }}</option>
            <option v-for="id in d.categoryChoices ?? [d.categoryId]" :key="id" :value="id">{{ catName(id) }}</option>
          </select>
        </label>
        <label :class="label">{{ t.card.description }}<input v-model="d.description" :class="field"></label>
      </template>

      <template v-if="d.kind === 'reminder'">
        <label :class="label">{{ t.card.title }}<input v-model="d.title" :class="field" data-testid="card-title"></label>
        <label :class="label">{{ t.card.due }}<input v-model="d.dueOn" type="date" :class="field"></label>
        <label class="flex min-h-11 items-center gap-2.5 text-sm text-white"><input v-model="d.repeatYearly" type="checkbox" class="size-5 accent-accent">{{ t.card.everyYear }}</label>
      </template>

      <label v-if="['add_part', 'shopping', 'expense', 'reminder'].includes(d.kind)" :class="label">{{ t.card.bike }}
        <select v-model="d.bikeId" :class="field">
          <option value="">{{ t.common.noBike }}</option>
          <option v-for="b in ctx.bikes" :key="b.id" :value="b.id">{{ b.name }}</option>
        </select>
      </label>
    </fieldset>

    <p v-if="d.status === 'failed'" role="alert" class="mt-2 text-sm text-danger-text" data-testid="card-error">{{ d.error }}</p>
  </li>
</template>
