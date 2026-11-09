<script setup lang="ts">
const { message, action, hide, act } = useToast()
</script>

<template>
  <div class="pointer-events-none fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-30 flex justify-center px-4" aria-live="polite" role="status">
    <div
      v-if="message"
      class="pointer-events-auto flex max-w-md items-center gap-2 rounded-xl bg-[#2a3038] text-sm font-semibold text-white shadow-lg shadow-black/40"
      data-testid="toast"
    >
      <button type="button" class="flex-1 px-4 py-3 text-left" @click="hide">{{ message }}</button>
      <button v-if="action" type="button" class="min-h-11 shrink-0 px-4 font-bold text-accent" data-testid="toast-action" @click="act">{{ action.label }}</button>
    </div>
  </div>
</template>
