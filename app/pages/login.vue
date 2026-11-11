<script setup lang="ts">
import { authClient } from '~/lib/auth-client'
import { offlineMessage } from '~/offline/outbox'
const { t } = useI18n()

const email = ref('')
const password = ref('')
const error = ref('')
const busy = ref(false)
const deleted = useRoute().query.deleted === '1'

async function submit() {
  error.value = ''
  // Auth is online-only: say so instead of "wrong password".
  if (navigator.onLine === false) return void (error.value = offlineMessage())
  busy.value = true
  let err: { status?: number } | null
  try {
    ;({ error: err } = await authClient.signIn.email({ email: email.value.trim(), password: password.value }))
  } catch {
    busy.value = false
    return void (error.value = offlineMessage())
  }
  busy.value = false
  if (err) {
    error.value = err.status === 429 ? t.value.login.tooMany : t.value.login.wrong
    return
  }
  await navigateTo('/')
}
</script>

<template>
  <main class="mx-auto flex min-h-dvh max-w-sm lg:max-w-md flex-col justify-center px-5 py-8 lg:p-8">
    <div class="lg:border lg:border-text/15 lg:p-8 lg:rounded-2xl lg:bg-surface/80 lg:shadow-2xl">
      <div class="flex items-center gap-3 mb-2">
        <BrandMark />
        <h1 class="text-3xl font-bold text-accent-text tracking-tight">Dirt Garage</h1>
      </div>
      <p class="mt-1 text-sm text-muted font-tag uppercase tracking-wider text-xs">{{ t.login.intro }}</p>
      <p v-if="deleted" role="status" class="mt-4 rounded-lg bg-surface p-3 text-sm text-text" data-testid="deleted-notice">{{ t.login.deleted }}</p>

      <form class="mt-6 space-y-4" @submit.prevent="submit">
        <label class="block">
          <span class="text-xs uppercase font-tag tracking-wider text-muted">{{ t.login.email }}</span>
          <input
            v-model="email"
            type="email"
            autocomplete="email"
            required
            class="mt-1 w-full rounded-lg border border-white/10 bg-bg px-3 py-3 text-base text-text outline-none focus:border-accent"
          >
        </label>
        <label class="block">
          <span class="text-xs uppercase font-tag tracking-wider text-muted">{{ t.login.password }}</span>
          <input
            v-model="password"
            type="password"
            autocomplete="current-password"
            required
            class="mt-1 w-full rounded-lg border border-white/10 bg-bg px-3 py-3 text-base text-text outline-none focus:border-accent"
          >
        </label>
        <p v-if="error" role="alert" class="text-sm text-danger-text">{{ error }}</p>
        <button
          type="submit"
          :disabled="busy"
          class="w-full rounded-lg bg-accent py-3 text-base font-bold uppercase font-tag text-on-accent disabled:opacity-60 hover:brightness-110 active:scale-95 transition"
        >
          {{ t.login.signIn }}
        </button>
      </form>

      <p class="mt-6 text-center text-xs font-tag uppercase text-muted">
        {{ t.login.newHere }}
        <NuxtLink to="/register" class="text-accent-text underline font-bold">{{ t.login.create }}</NuxtLink>
      </p>
    </div>
  </main>
</template>
