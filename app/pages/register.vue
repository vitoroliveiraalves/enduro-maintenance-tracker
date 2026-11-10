<script setup lang="ts">
import { authClient } from '~/lib/auth-client'
import { offlineMessage } from '~/offline/outbox'
const { t } = useI18n()

const email = ref('')
const password = ref('')
const confirm = ref('')
const error = ref('')
const busy = ref(false)

async function submit() {
  error.value = ''
  if (password.value.length < 8) {
    error.value = t.value.register.tooShort
    return
  }
  if (password.value !== confirm.value) {
    error.value = t.value.register.noMatch
    return
  }
  // Auth is online-only: say so instead of "wrong password".
  if (navigator.onLine === false) return void (error.value = offlineMessage())
  busy.value = true
  const addr = email.value.trim()
  let res: Awaited<ReturnType<typeof authClient.signUp.email>>
  try {
    res = await authClient.signUp.email({ email: addr, password: password.value, name: addr.split('@')[0]! })
  } catch {
    busy.value = false
    return void (error.value = offlineMessage())
  }
  const err = res.error
  busy.value = false
  if (err) {
    if (err.status === 429) error.value = t.value.login.tooMany
    else if (err.code === 'USER_ALREADY_EXISTS' || /already exists/i.test(err.message ?? ''))
      error.value = t.value.register.exists
    else if (err.code === 'PASSWORD_TOO_SHORT') error.value = t.value.register.tooShort
    else error.value = t.value.register.failed
    return
  }
  await navigateTo('/')
}
</script>

<template>
  <main class="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-5 py-8">
    <h1 class="text-3xl font-bold text-accent-text">{{ t.register.title }}</h1>
    <p class="mt-1 text-sm text-muted">{{ t.register.intro }}</p>

    <form class="mt-8 space-y-4" @submit.prevent="submit">
      <label class="block">
        <span class="text-sm text-muted">{{ t.login.email }}</span>
        <input
          v-model="email"
          type="email"
          autocomplete="email"
          required
          class="mt-1 w-full rounded-lg border border-white/10 bg-surface px-3 py-3 text-base text-text outline-none focus:border-accent"
        >
      </label>
      <label class="block">
        <span class="text-sm text-muted">{{ t.register.passwordMin }}</span>
        <input
          v-model="password"
          type="password"
          autocomplete="new-password"
          required
          class="mt-1 w-full rounded-lg border border-white/10 bg-surface px-3 py-3 text-base text-text outline-none focus:border-accent"
        >
      </label>
      <label class="block">
        <span class="text-sm text-muted">{{ t.register.confirm }}</span>
        <input
          v-model="confirm"
          type="password"
          autocomplete="new-password"
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
        {{ t.register.title }}
      </button>
    </form>

    <p class="mt-5 rounded-lg bg-surface p-3 text-xs leading-relaxed text-muted">
      {{ t.register.privacy }}
    </p>

    <p class="mt-6 text-center text-sm text-muted">
      {{ t.register.haveAccount }}
      <NuxtLink to="/login" class="text-accent-text underline">{{ t.login.signIn }}</NuxtLink>
    </p>
  </main>
</template>
