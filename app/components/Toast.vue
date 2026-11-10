<script setup lang="ts">
const { message, action, hide, act } = useToast()
</script>

<template>
  <div class="pointer-events-none fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-30 flex justify-center px-4" aria-live="polite" role="status">
    <Transition
      enter-active-class="transition duration-200 ease-out"
      enter-from-class="translate-y-4 opacity-0 scale-95"
      enter-to-class="translate-y-0 opacity-100 scale-100"
      leave-active-class="transition duration-150 ease-in"
      leave-from-class="translate-y-0 opacity-100 scale-100"
      leave-to-class="translate-y-4 opacity-0 scale-95"
    >
      <div
        v-if="message"
        class="pointer-events-auto flex max-w-md items-center gap-2 rounded-xl bg-surface ring-1 ring-white/15 text-sm font-semibold text-white shadow-lg shadow-black/40"
        data-testid="toast"
      >
        <button type="button" class="flex-1 px-4 py-3 text-left" @click="hide">{{ message }}</button>
        <button v-if="action" type="button" class="min-h-11 shrink-0 px-4 font-bold text-accent-text active:scale-95" data-testid="toast-action" @click="act">{{ action.label }}</button>
      </div>
    </Transition>
  </div>
</template>
