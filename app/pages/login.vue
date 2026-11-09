<script setup lang="ts">
import { authClient } from '~/lib/auth-client'
import { OFFLINE_MESSAGE } from '~/offline/outbox'

const email = ref('')
const password = ref('')
const error = ref('')
const busy = ref(false)
const deleted = useRoute().query.deleted === '1'

async function submit() {
  error.value = ''
  // Auth is online-only: say so instead of "wrong password".
  if (navigator.onLine === false) return void (error.value = OFFLINE_MESSAGE)
  busy.value = true
  let err: { status?: number } | null
  try {
    ;({ error: err } = await authClient.signIn.email({ email: email.value.trim(), password: password.value }))
  } catch {
    busy.value = false
    return void (error.value = OFFLINE_MESSAGE)
  }
  busy.value = false
  if (err) {
    error.value = err.status === 429 ? 'Too many attempts — wait a minute and try again' : 'Wrong email or password'
    return
  }
  await navigateTo('/')
}
</script>

<template>
  <main class="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-5 py-8">
    <h1 class="text-3xl font-bold text-accent-text">Enduro Tracker</h1>
    <p class="mt-1 text-sm text-muted">Sign in to your garage.</p>
    <p v-if="deleted" role="status" class="mt-4 rounded-lg bg-surface p-3 text-sm text-text" data-testid="deleted-notice">Your account and data were deleted.</p>

    <form class="mt-8 space-y-4" @submit.prevent="submit">
      <label class="block">
        <span class="text-sm text-muted">Email</span>
        <input
          v-model="email"
          type="email"
          autocomplete="email"
          required
          class="mt-1 w-full rounded-lg border border-white/10 bg-surface px-3 py-3 text-base text-text outline-none focus:border-accent"
        >
      </label>
      <label class="block">
        <span class="text-sm text-muted">Password</span>
        <input
          v-model="password"
          type="password"
          autocomplete="current-password"
          required
          class="mt-1 w-full rounded-lg border border-white/10 bg-surface px-3 py-3 text-base text-text outline-none focus:border-accent"
        >
      </label>
      <p v-if="error" role="alert" class="text-sm text-danger-text">{{ error }}</p>
      <button
        type="submit"
        :disabled="busy"
        class="w-full rounded-lg bg-accent py-3 text-base font-semibold text-on-accent disabled:opacity-60"
      >
        Sign in
      </button>
    </form>

    <p class="mt-6 text-center text-sm text-muted">
      New here?
      <NuxtLink to="/register" class="text-accent-text underline">Create an account</NuxtLink>
    </p>
  </main>
</template>
