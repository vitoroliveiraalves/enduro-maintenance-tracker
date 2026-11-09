<script setup lang="ts">
// Line icons (stroke = currentColor), decorative unless the parent labels them.
type Name = 'garage' | 'history' | 'invoice' | 'costs' | 'speaker' | 'mic' | 'settings' | 'shelf'
withDefaults(defineProps<{ name: Name; size?: number }>(), { size: 20 })
const PATHS: Record<Name, string[]> = {
  garage: ['M3 10 12 4l9 6v10H3z', 'M7 20v-6h10v6M7 17h10'],
  history: ['M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16z', 'M12 8v4l3 2'],
  invoice: ['M6 3h12v18l-3-2-3 2-3-2-3 2z', 'M9 8h6M9 12h6'],
  costs: ['M4 20V10M10 20V4M16 20v-7M22 20H2'],
  speaker: ['M4 9h4l5-4v14l-5-4H4z', 'M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12'],
  mic: ['M9 6a3 3 0 0 1 6 0v5a3 3 0 0 1-6 0z', 'M5 11a7 7 0 0 0 14 0M12 18v3'],
  settings: ['M4 7h10M18 7h2M4 17h2M10 17h10', 'M14 7a2 2 0 1 0 4 0 2 2 0 0 0-4 0zM6 17a2 2 0 1 0 4 0 2 2 0 0 0-4 0z'],
  shelf: ['M3 6h18M3 12h18M3 18h18M6 6v12M18 6v12'],
}
</script>

<template>
  <svg :width="size" :height="size" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path v-for="d in PATHS[name]" :key="d" :d="d" />
  </svg>
</template>
