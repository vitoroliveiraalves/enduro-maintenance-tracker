<script setup lang="ts">
import { errorMessage } from '~/offline/outbox'
const { t } = useI18n()

/** Rename + remove (with an in-page "are you sure"), for a bike or an item. */
const props = defineProps<{
  what: 'bike' | 'item'
  name: string
  removeNote: string
  rename: (name: string) => Promise<void>
  remove: () => Promise<void>
}>()

const nameText = ref(props.name)
watch(() => props.name, (n) => (nameText.value = n))
const askRemove = ref(false)
const busy = ref(false)
const error = ref('')

async function run(fn: () => Promise<void>) {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    await fn()
  } catch (e) {
    error.value = errorMessage(e, t.value.manage.saveFailed)
  } finally {
    busy.value = false
  }
}
function saveName() {
  const n = nameText.value.trim()
  if (!n) return void (error.value = t.value.manage.needName(t.value.manage.what[props.what]))
  if (n !== props.name) run(() => props.rename(n))
}
</script>

<template>
  <section class="rounded-xl bg-surface p-3" :data-testid="`manage-${props.what}`">
    <form class="flex items-end gap-2" @submit.prevent="saveName">
      <label class="min-w-0 flex-1 text-[11px] uppercase tracking-wider text-muted">
        {{ t.manage.name }}
        <input v-model="nameText" maxlength="80" autocomplete="off" :data-testid="`${props.what}-rename`" class="mt-1 block w-full rounded-xl bg-bg px-3 py-3 text-base normal-case text-white outline-none focus:ring-2 focus:ring-accent">
      </label>
      <button type="submit" :disabled="busy || nameText.trim() === props.name" class="min-h-12 rounded-xl bg-bg px-4 text-sm font-semibold text-accent-text disabled:opacity-40" :data-testid="`${props.what}-rename-save`">{{ t.manage.rename }}</button>
    </form>
    <p v-if="error" role="alert" class="mt-2 text-sm text-danger-text">{{ error }}</p>
    <button v-if="!askRemove" type="button" class="mt-3 min-h-11 text-sm text-danger-text" :data-testid="`${props.what}-remove`" @click="askRemove = true">
      {{ t.manage.remove(t.manage.what[props.what]) }}
    </button>
    <div v-else role="alert" class="mt-3 rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm">
      <p class="text-text">{{ t.manage.removeAsk(props.name) }} {{ props.removeNote }}</p>
      <div class="mt-2 flex gap-2">
        <button type="button" class="min-h-11 rounded-lg bg-danger px-4 font-bold text-on-danger" :disabled="busy" :data-testid="`${props.what}-remove-confirm`" @click="run(props.remove)">{{ t.common.remove }}</button>
        <button type="button" class="min-h-11 rounded-lg px-4 text-muted" @click="askRemove = false">{{ t.common.keep }}</button>
      </div>
    </div>
  </section>
</template>
