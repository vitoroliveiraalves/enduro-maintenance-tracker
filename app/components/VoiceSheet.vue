<script setup lang="ts">
// The voice note's result. Task 13 adds the editable transcript, cards and sources.
const voice = useVoice()
const open = computed({ get: () => voice.open.value, set: (v) => (v ? (voice.open.value = true) : voice.close()) })
</script>

<template>
  <Sheet v-model:open="open" title="Voice note" testid="voice-sheet">
    <p v-if="voice.sheet.value.status === 'listening'" class="py-6 text-center text-sm text-muted" data-testid="voice-listening">Listening…</p>
    <p v-else-if="voice.sheet.value.status === 'error'" role="alert" class="text-sm text-danger" data-testid="voice-error">{{ voice.sheet.value.error }}</p>
    <template v-else-if="voice.sheet.value.result">
      <p class="text-sm text-muted" data-testid="voice-transcript">{{ voice.sheet.value.result.transcript }}</p>
      <p v-if="voice.sheet.value.result.answer" class="mt-3 text-base text-white" data-testid="voice-answer">{{ voice.sheet.value.result.answer }}</p>
    </template>
  </Sheet>
</template>
