<script setup lang="ts">
// The app mark: the home-screen icon's quarter tyre (scripts/pwa-icons.mjs), drawn with the look's tokens.
const knobs = Array.from({ length: 34 }, (_, i) => (i * 360) / 34)
</script>

<template>
  <svg class="brand-mark" viewBox="0 0 120 120" aria-hidden="true" data-testid="brand-mark">
    <g transform="translate(124 124)">
      <circle r="60" fill="none" stroke-width="8" class="stroke-stripe-b" />
      <circle r="70" fill="none" stroke-width="8" class="stroke-stripe-a" />
      <circle r="86" fill="none" stroke-width="18" class="stroke-text" />
      <rect v-for="a in knobs" :key="a" x="-5.5" y="-108" width="11" height="12" class="fill-text" :transform="`rotate(${a})`" />
    </g>
  </svg>
</template>
