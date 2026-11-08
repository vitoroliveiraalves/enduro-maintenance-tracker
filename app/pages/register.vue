<script setup lang="ts">
import { authClient } from '~/lib/auth-client'

const email = ref('')
const password = ref('')
const confirm = ref('')
const error = ref('')
const busy = ref(false)

async function submit() {
  error.value = ''
  if (password.value.length < 8) {
    error.value = 'Password must be at least 8 characters'
    return
  }
  if (password.value !== confirm.value) {
    error.value = 'Passwords do not match'
    return
  }
  busy.value = true
  const addr = email.value.trim()
  const { error: err } = await authClient.signUp.email({ email: addr, password: password.value, name: addr.split('@')[0]! })
  busy.value = false
  if (err) {
    if (err.status === 429) error.value = 'Too many attempts — wait a minute and try again'
    else if (err.code === 'USER_ALREADY_EXISTS' || /already exists/i.test(err.message ?? ''))
      error.value = 'An account with this email already exists'
    else if (err.code === 'PASSWORD_TOO_SHORT') error.value = 'Password must be at least 8 characters'
    else error.value = err.message || 'Could not create the account'
    return
  }
  await navigateTo('/')
}
</script>

<template>
  <main class="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-5 py-8">
    <h1 class="text-3xl font-bold text-accent">Create account</h1>
    <p class="mt-1 text-sm text-muted">Enduro Tracker keeps your bikes, service and costs.</p>

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
        <span class="text-sm text-muted">Password (min. 8 characters)</span>
        <input
          v-model="password"
          type="password"
          autocomplete="new-password"
          required
          class="mt-1 w-full rounded-lg border border-white/10 bg-surface px-3 py-3 text-base text-text outline-none focus:border-accent"
        >
      </label>
      <label class="block">
        <span class="text-sm text-muted">Confirm password</span>
        <input
          v-model="confirm"
          type="password"
          autocomplete="new-password"
          required
          class="mt-1 w-full rounded-lg border border-white/10 bg-surface px-3 py-3 text-base text-text outline-none focus:border-accent"
        >
      </label>
      <p v-if="error" role="alert" class="text-sm text-danger">{{ error }}</p>
      <button
        type="submit"
        :disabled="busy"
        class="w-full rounded-lg bg-accent py-3 text-base font-semibold text-black disabled:opacity-60"
      >
        Create account
      </button>
    </form>

    <p class="mt-5 rounded-lg bg-surface p-3 text-xs leading-relaxed text-muted">
      Your bikes, costs and invoice photos are stored on our server. Invoice photos are sent to an AI service (via OpenRouter) to read them.
    </p>

    <p class="mt-6 text-center text-sm text-muted">
      Already have an account?
      <NuxtLink to="/login" class="text-accent underline">Sign in</NuxtLink>
    </p>
  </main>
</template>
