<script setup lang="ts">
import { formatDate } from '~/lib/format'
import { errorMessage } from '~/offline/outbox'
import { readSession } from '~/offline/session'
import { daysUntil, dueText } from '~/lib/reminders'

type Reminder = { id: string; bikeId: string | null; bikeName: string | null; title: string; dueOn: string; repeatYearly: boolean; pending?: boolean }

const { get, mutate } = useApi()
const store = useBikesStore()
const push = usePush()
const voice = useVoice()
const { pending, syncTick } = useOffline()
const look = useTheme()

const email = ref('')
const reminders = ref<Reminder[]>([])
const remError = ref('')
const sheetOpen = ref(false)

async function loadReminders() {
  try {
    reminders.value = await get<Reminder[]>('/api/reminders')
  } catch {
    remError.value = "Couldn't load reminders."
  }
}

onMounted(async () => {
  push.init()
  void voice.checkAvailable()
  loadReminders()
  store.fetchBikes().catch(() => {})
  // The auth middleware just checked (or, offline, trusted) this session.
  email.value = readSession()?.email ?? ''
})
watch(syncTick, loadReminders)

function when(r: Reminder) {
  const d = daysUntil(r.dueOn)
  return { text: `${formatDate(r.dueOn)} · ${dueText(d)}`, tone: d < 0 ? 'text-danger-text' : d <= 30 ? 'text-warn-text' : 'text-muted' }
}

const acting = ref(false)
const askRemove = ref<string | null>(null) // reminder id waiting for "Remove?" confirmation
const toast = useToast()
async function act(r: Reminder, kind: 'done' | 'remove') {
  if (acting.value) return // a double tap must not mark a yearly reminder done twice
  acting.value = true
  remError.value = ''
  try {
    if (kind === 'done') await mutate(`/api/reminders/${r.id}/done`, { dueOn: r.dueOn }, { queue: true })
    else await mutate(`/api/reminders/${r.id}`, {}, { method: 'DELETE', queue: true })
    askRemove.value = null
    await loadReminders()
    const next = reminders.value.find((x) => x.id === r.id)
    toast.show(kind === 'remove' ? `${r.title} reminder removed` : next ? `${r.title} done · next due ${formatDate(next.dueOn)}` : `${r.title} done`)
  } catch (e) {
    remError.value = errorMessage(e, "Couldn't update the reminder. Try again.", true)
  } finally {
    acting.value = false
  }
}

function toggle() {
  if (push.state.value === 'on') push.disable()
  else push.enable()
}

const signOutError = ref('')
async function signOut() {
  signOutError.value = ''
  try {
    await signOutEverywhere()
  } catch (e) {
    signOutError.value = errorMessage(e, "Couldn't sign out. Try again.")
  }
}

const confirmText = ref('')
const deleting = ref(false)
const deleteError = ref('')
async function deleteAccount() {
  if (confirmText.value !== 'DELETE' || deleting.value) return
  deleting.value = true
  deleteError.value = ''
  try {
    if (push.state.value === 'on') await push.disable()
    await mutate('/api/account', { confirm: 'DELETE' }, { method: 'DELETE' }) // online-only, never queued
    await forgetThisDevice()
    await navigateTo('/login?deleted=1')
  } catch (e) {
    deleteError.value = errorMessage(e, "Couldn't delete your account. Nothing was removed — try again.", true)
  } finally {
    deleting.value = false
  }
}

const h2 = 'mb-1.5 mt-6 text-[11px] uppercase tracking-[0.08em] text-muted'
</script>

<template>
  <main class="mx-auto max-w-md px-4 pb-6 pt-[18px]">
    <div class="text-[13px] text-muted">
      <NuxtLink to="/" class="-m-2 p-2 font-tag text-xs">← GARAGE</NuxtLink>
    </div>
    <h1 class="mt-2 text-[34px] text-white">Settings</h1>

    <h2 :class="h2">Look</h2>
    <fieldset class="grid gap-2" data-testid="theme-section">
      <legend class="sr-only">Look of the app on this phone</legend>
      <label
        v-for="t in look.themes"
        :key="t.id"
        class="flex min-h-14 cursor-pointer items-center gap-3 border-[1.5px] px-3 py-2.5"
        :class="look.theme.value === t.id ? 'border-text' : 'border-white/15'"
      >
        <input type="radio" name="theme" class="size-5 accent-accent" :value="t.id" :checked="look.theme.value === t.id" @change="look.set(t.id)">
        <span class="min-w-0 flex-1">
          <span class="block font-extrabold uppercase text-white" style="font-stretch: 110%">{{ t.name }}</span>
          <span class="block text-xs text-muted">{{ t.hint }}</span>
        </span>
        <span class="flex shrink-0" aria-hidden="true">
          <template v-if="t.id === 'steel'"><i class="size-5 bg-[#0e0e0e] ring-1 ring-white/30" /><i class="size-5 bg-[#ededed]" /></template>
          <template v-else><i class="size-5 bg-[#d21f2a]" /><i class="size-5 bg-[#f4f1ea]" /><i class="size-5 bg-[#1f3fa8]" /></template>
        </span>
      </label>
    </fieldset>
    <p class="mt-1.5 text-xs text-muted">Saved on this phone only.</p>

    <h2 :class="h2">Notifications</h2>
    <section class="rounded-xl bg-surface p-3" data-testid="push-section">
      <div class="flex items-center justify-between gap-3">
        <div>
          <p class="text-sm font-semibold text-white">Push notifications</p>
          <p class="text-xs text-muted">Maintenance due, renewals coming up, and a Monday nudge to log your rides.</p>
        </div>
        <button
          v-if="push.state.value === 'on' || push.state.value === 'off'"
          type="button"
          role="switch"
          :aria-checked="push.state.value === 'on'"
          aria-label="Push notifications"
          :disabled="push.busy.value"
          data-testid="push-toggle"
          class="relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-60"
          :class="push.state.value === 'on' ? 'bg-accent' : 'bg-track'"
          @click="toggle"
        >
          <span class="absolute top-1 h-5 w-5 rounded-full bg-white transition-all" :class="push.state.value === 'on' ? 'left-6' : 'left-1'" />
        </button>
      </div>
      <p v-if="push.state.value === 'not-configured'" class="mt-2 text-sm text-muted" data-testid="push-not-configured">Notifications aren't set up on this server.</p>
      <template v-else-if="push.state.value === 'ios-not-installed'">
        <p class="mt-2 text-sm text-warn-text" data-testid="push-ios">Add to Home Screen first, then turn notifications on.</p>
        <div class="mt-2"><InstallPrompt /></div>
      </template>
      <p v-else-if="push.state.value === 'unsupported'" class="mt-2 text-sm text-muted">This browser can't receive push notifications.</p>
      <p v-else-if="push.state.value === 'denied'" class="mt-2 text-sm text-muted" data-testid="push-denied">Notifications are blocked for this site. Allow them in your browser or phone settings, then come back.</p>
      <p v-if="push.error.value" role="alert" class="mt-2 text-sm text-danger-text" data-testid="push-error">{{ push.error.value }}</p>
    </section>

    <template v-if="push.state.value !== 'ios-not-installed'">
      <InstallPrompt class="mt-3" />
    </template>

    <h2 :class="h2">Voice notes</h2>
    <section class="rounded-xl bg-surface p-3 text-sm" data-testid="voice-section">
      <p v-if="voice.available.value" class="text-white" data-testid="voice-on">Hold the round mic button to log a ride, a service or a cost, or to ask about your bike.</p>
      <p v-else class="text-muted" data-testid="voice-off">Voice isn't set up on this server.</p>
      <p class="mt-2 text-xs leading-relaxed text-muted">Invoice photos and voice notes are sent to an AI service (via OpenRouter) to read them; voice notes aren't kept.</p>
    </section>

    <h2 id="reminders" :class="h2" class="scroll-mt-4">Reminders</h2>
    <section data-testid="reminders-section">
      <p v-if="!reminders.length" class="rounded-xl bg-surface p-3 text-sm text-muted">No reminders yet — insurance, IUC, inspection…</p>
      <div v-for="r in reminders" :key="r.id" class="mb-2 rounded-xl bg-surface p-3" data-testid="reminder-row">
        <div class="flex items-baseline justify-between gap-2">
          <span class="text-sm font-semibold text-white" data-testid="reminder-title">{{ r.title }}</span>
          <span class="text-xs text-muted">{{ r.bikeName ?? 'All bikes' }}{{ r.repeatYearly ? ' · yearly' : '' }}<span v-if="r.pending" class="text-warn-text"> · pending sync</span></span>
        </div>
        <div class="mt-0.5 text-xs" :class="when(r).tone" data-testid="reminder-when">{{ when(r).text }}</div>
        <div v-if="!r.pending" class="mt-2 flex gap-2">
          <template v-if="askRemove !== r.id">
            <button type="button" class="min-h-11 rounded-lg bg-bg px-4 text-[13px] font-semibold text-ok-text" data-testid="reminder-done" :disabled="acting" @click="act(r, 'done')">✓ Done</button>
            <button type="button" class="min-h-11 rounded-lg px-4 text-[13px] text-muted" data-testid="reminder-remove" :disabled="acting" @click="askRemove = r.id">Remove</button>
          </template>
          <template v-else>
            <span class="self-center text-[13px] text-text">Remove {{ r.title }}?</span>
            <button type="button" class="min-h-11 rounded-lg bg-danger px-4 text-[13px] font-bold text-on-danger" data-testid="reminder-remove-confirm" :disabled="acting" @click="act(r, 'remove')">Remove</button>
            <button type="button" class="min-h-11 rounded-lg px-4 text-[13px] text-muted" @click="askRemove = null">Keep</button>
          </template>
        </div>
      </div>
      <p v-if="remError" role="alert" class="mt-2 text-sm text-danger-text">{{ remError }}</p>
      <button type="button" class="mt-1 w-full rounded-xl border border-dashed border-white/15 py-3 text-sm font-semibold text-accent-text" data-testid="add-reminder" @click="sheetOpen = true">+ Add reminder</button>
    </section>
    <ReminderSheet v-model:open="sheetOpen" :bikes="store.bikes" @saved="loadReminders" />

    <h2 :class="h2">Account</h2>
    <section class="rounded-xl bg-surface p-3">
      <p class="text-sm text-muted">Signed in as <span class="text-white" data-testid="account-email">{{ email }}</span></p>
      <p v-if="pending" class="mt-2 text-xs text-warn-text" data-testid="sign-out-pending">
        {{ pending === 1 ? '1 change hasn’t' : `${pending} changes haven’t` }} synced yet — signing out now would lose {{ pending === 1 ? 'it' : 'them' }}.
      </p>
      <button type="button" class="mt-2 w-full rounded-xl bg-bg py-3 text-sm font-semibold text-white" data-testid="sign-out" @click="signOut">Sign out</button>
      <p v-if="signOutError" role="alert" class="mt-2 text-sm text-danger-text" data-testid="sign-out-error">{{ signOutError }}</p>
    </section>

    <section class="mt-3 rounded-xl border border-danger/40 bg-surface p-3" data-testid="delete-account">
      <p class="text-sm font-semibold text-danger-text">Delete my account and data</p>
      <p class="mt-1 text-xs text-muted">Removes your bikes, readings, services, costs, invoice photos and reminders for good. This can't be undone.</p>
      <label class="mt-3 block text-[11px] uppercase tracking-wider text-muted">
        Type DELETE to confirm
        <input
          v-model="confirmText"
          autocomplete="off"
          autocapitalize="characters"
          spellcheck="false"
          data-testid="delete-confirm"
          class="mt-1 block w-full rounded-xl bg-bg px-3 py-3 text-base text-white outline-none focus:ring-2 focus:ring-danger"
        >
      </label>
      <p v-if="deleteError" role="alert" class="mt-2 text-sm text-danger-text">{{ deleteError }}</p>
      <button
        type="button"
        :disabled="confirmText !== 'DELETE' || deleting"
        class="mt-3 w-full rounded-xl bg-danger py-3 text-sm font-bold text-on-danger disabled:opacity-40"
        data-testid="delete-account-button"
        @click="deleteAccount"
      >
        Delete my account and data
      </button>
    </section>
  </main>
</template>
