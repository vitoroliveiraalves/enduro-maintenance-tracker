<script setup lang="ts">
const { t } = useI18n()
/** "Counts: Hours & km / Km only / Hours only" — what a bike's meters are. */
const model = defineModel<BikeMeters>({ required: true })
defineProps<{ disabled?: boolean }>()
</script>

<template>
  <fieldset class="block" data-testid="meters-choice">
    <legend class="text-sm text-muted">{{ t.meters.counts }}</legend>
    <div class="mt-1 flex gap-2">
      <label
        v-for="m in BIKE_METERS" :key="m"
        class="flex min-h-11 flex-1 cursor-pointer items-center justify-center rounded-lg border px-2 py-2 text-center text-sm"
        :class="[model === m ? 'border-accent text-accent-text' : 'border-white/10 bg-surface', disabled ? 'opacity-60' : '']"
      >
        <input v-model="model" type="radio" :value="m" :disabled="disabled" class="sr-only">{{ t.meters.label[m] }}
      </label>
    </div>
  </fieldset>
</template>
