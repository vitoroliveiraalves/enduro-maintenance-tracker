<script setup lang="ts">
import { authClient } from '~/lib/auth-client'

async function signOut() {
  await authClient.signOut()
  await navigateTo('/login')
}
</script>

<template>
  <main class="p-4">
    <h1 class="text-2xl font-bold text-accent">Garage</h1>
    <p class="mt-3 text-muted" data-testid="empty-garage">No bikes yet.</p>
    <button class="mt-6 text-sm text-muted underline" @click="signOut">Sign out</button>
  </main>
</template>
