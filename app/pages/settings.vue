<script setup lang="ts">
import { formatDate, formatMoney } from '~/lib/format'
import { errorMessage } from '~/offline/outbox'
import { readSession } from '~/offline/session'
import { daysUntil, dueText } from '~/lib/reminders'

type Reminder = {
  id: string
  bikeId: string | null
  bikeName: string | null
  title: string
  dueOn: string
  repeatYearly: boolean
  amountCents?: number | null
  provider?: string | null
  policyNumber?: string | null
  doneAt?: string | null
  pending?: boolean
}

const { get, mutate } = useApi()
const store = useBikesStore()
const push = usePush()
const voice = useVoice()
const { pending, syncTick } = useOffline()
const look = useTheme()
const lang = useI18n()
const { t } = lang
const LANG_CHOICES = ['auto', 'en', 'pt'] as const
function chooseLanguage(c: (typeof LANG_CHOICES)[number]) {
  lang.choose(c)
  void push.resync() // pushes to this phone follow the new language
}

const email = ref('')
const isAdmin = ref(false)
const reminders = ref<Reminder[]>([])
const remError = ref('')
const sheetOpen = ref(false)
const reminderToEdit = ref<Reminder | null>(null)

async function editReminder(r: Reminder) {
  reminderToEdit.value = r
  if (!store.bikes.length) await store.fetchBikes().catch(() => {})
  sheetOpen.value = true
}

async function openNewReminder() {
  reminderToEdit.value = null
  if (!store.bikes.length) await store.fetchBikes().catch(() => {})
  sheetOpen.value = true
}

type ApiTokenSummary = {
  id: string
  name: string
  tokenPrefix: string
  lastUsedAt: string | null
  createdAt: string
}
const mcpTokens = ref<ApiTokenSummary[]>([])
const mcpTokensLoading = ref(false)
const mcpSheetOpen = ref(false)
const askRevoke = ref<string | null>(null)
const mcpError = ref('')

async function loadMcpTokens() {
  mcpTokensLoading.value = true
  mcpError.value = ''
  try {
    mcpTokens.value = await get<ApiTokenSummary[]>('/api/tokens')
  } catch {
    // offline or error
  } finally {
    mcpTokensLoading.value = false
  }
}

async function revokeToken(id: string) {
  try {
    await mutate(`/api/tokens/${id}`, {}, { method: 'DELETE' })
    askRevoke.value = null
    await loadMcpTokens()
  } catch {
    mcpError.value = t.value.settings.mcpRevokeFailed
  }
}

async function loadReminders() {
  try {
    reminders.value = await get<Reminder[]>('/api/reminders')
  } catch {
    remError.value = t.value.settings.remindersFailed
  }
}

onMounted(async () => {
  push.init()
  void voice.checkAvailable()
  loadReminders()
  loadMcpTokens()
  store.fetchBikes().catch(() => {})
  // The auth middleware just checked (or, offline, trusted) this session.
  email.value = readSession()?.email ?? ''
  get<{ admin: boolean }>('/api/account')
    .then((a) => (isAdmin.value = a.admin))
    .catch(() => {})
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
    const st = t.value.settings
    toast.show(kind === 'remove' ? st.reminderRemoved(r.title) : next ? st.reminderDoneNext(r.title, formatDate(next.dueOn)) : st.reminderDone(r.title))
  } catch (e) {
    remError.value = errorMessage(e, t.value.settings.reminderFailed, true)
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
    signOutError.value = errorMessage(e, t.value.settings.signOutFailed)
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
    deleteError.value = errorMessage(e, t.value.settings.deleteFailed, true)
  } finally {
    deleting.value = false
  }
}

const h2 = 'mb-1.5 mt-6 text-[11px] uppercase tracking-[0.08em] text-muted'
</script>

<template>
  <main class="mx-auto max-w-md px-4 pb-6 pt-[18px]">
    <div class="text-[13px] text-muted">
      <NuxtLink to="/" class="-m-2 p-2 font-tag text-xs">{{ t.common.garageBack }}</NuxtLink>
    </div>
    <h1 class="mt-2 text-[34px] text-white">{{ t.settings.title }}</h1>

    <h2 :class="h2">{{ t.language.title }}</h2>
    <fieldset class="grid gap-2" data-testid="language-section">
      <legend class="sr-only">{{ t.language.legend }}</legend>
      <label
        v-for="c in LANG_CHOICES"
        :key="c"
        class="flex min-h-14 cursor-pointer items-center gap-3 border-[1.5px] px-3 py-2.5"
        :class="lang.choice.value === c ? 'border-text' : 'border-white/15'"
        :data-testid="`language-${c}`"
      >
        <input type="radio" name="language" class="size-5 accent-accent" :value="c" :checked="lang.choice.value === c" @change="chooseLanguage(c)">
        <span class="min-w-0 flex-1">
          <span class="block font-extrabold uppercase text-white" style="font-stretch: 110%" :lang="c === 'pt' ? 'pt-PT' : c === 'en' ? 'en' : undefined">{{ c === 'auto' ? t.language.auto : t.language.names[c] }}</span>
          <span v-if="c === 'auto'" class="block text-xs text-muted">{{ t.language.autoHint(t.language.names[lang.phone()]) }}</span>
        </span>
      </label>
    </fieldset>
    <p class="mt-1.5 text-xs text-muted">{{ t.language.savedHere }}</p>

    <h2 :class="h2">{{ t.settings.look }}</h2>
    <fieldset class="grid gap-2" data-testid="theme-section">
      <legend class="sr-only">{{ t.settings.lookLegend }}</legend>
      <label
        v-for="th in look.themes"
        :key="th.id"
        class="flex min-h-14 cursor-pointer items-center gap-3 border-[1.5px] px-3 py-2.5"
        :class="look.theme.value === th.id ? 'border-text' : 'border-white/15'"
      >
        <input type="radio" name="theme" class="size-5 accent-accent" :value="th.id" :checked="look.theme.value === th.id" @change="look.set(th.id)">
        <span class="min-w-0 flex-1">
          <span class="block font-extrabold uppercase text-white" style="font-stretch: 110%">{{ t.settings.themes[th.id].name }}</span>
          <span class="block text-xs text-muted">{{ t.settings.themes[th.id].hint }}</span>
        </span>
        <span class="flex shrink-0" aria-hidden="true">
          <template v-if="th.id === 'steel'"><i class="size-5 bg-[#0e0e0e] ring-1 ring-white/30" /><i class="size-5 bg-[#ededed]" /></template>
          <template v-else><i class="size-5 bg-[#d21f2a]" /><i class="size-5 bg-[#f4f1ea]" /><i class="size-5 bg-[#1f3fa8]" /></template>
        </span>
      </label>
    </fieldset>
    <p class="mt-1.5 text-xs text-muted">{{ t.settings.savedHere }}</p>

    <h2 :class="h2">{{ t.settings.notifications }}</h2>
    <section class="rounded-xl bg-surface p-3" data-testid="push-section">
      <div class="flex items-center justify-between gap-3">
        <div>
          <p class="text-sm font-semibold text-white">{{ t.settings.push }}</p>
          <p class="text-xs text-muted">{{ t.settings.pushHint }}</p>
        </div>
        <button
          v-if="push.state.value === 'on' || push.state.value === 'off'"
          type="button"
          role="switch"
          :aria-checked="push.state.value === 'on'"
          :aria-label="t.settings.push"
          :disabled="push.busy.value"
          data-testid="push-toggle"
          class="relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-60"
          :class="push.state.value === 'on' ? 'bg-accent' : 'bg-track'"
          @click="toggle"
        >
          <span class="absolute top-1 h-5 w-5 rounded-full bg-white transition-all" :class="push.state.value === 'on' ? 'left-6' : 'left-1'" />
        </button>
      </div>
      <p v-if="push.state.value === 'not-configured'" class="mt-2 text-sm text-muted" data-testid="push-not-configured">{{ t.settings.pushNotConfigured }}</p>
      <template v-else-if="push.state.value === 'ios-not-installed'">
        <p class="mt-2 text-sm text-warn-text" data-testid="push-ios">{{ t.settings.pushIos }}</p>
        <div class="mt-2"><InstallPrompt /></div>
      </template>
      <p v-else-if="push.state.value === 'unsupported'" class="mt-2 text-sm text-muted">{{ t.settings.pushUnsupported }}</p>
      <p v-else-if="push.state.value === 'denied'" class="mt-2 text-sm text-muted" data-testid="push-denied">{{ t.settings.pushDenied }}</p>
      <p v-if="push.error.value" role="alert" class="mt-2 text-sm text-danger-text" data-testid="push-error">{{ push.error.value }}</p>
    </section>

    <template v-if="push.state.value !== 'ios-not-installed'">
      <InstallPrompt class="mt-3" />
    </template>

    <h2 :class="h2">{{ t.settings.voice }}</h2>
    <section class="rounded-xl bg-surface p-3 text-sm" data-testid="voice-section">
      <p v-if="voice.available.value" class="text-white" data-testid="voice-on">{{ t.settings.voiceOn }}</p>
      <p v-else-if="voice.off.value" class="text-muted" data-testid="voice-off-account">{{ t.settings.voiceOffAccount }}</p>
      <p v-else class="text-muted" data-testid="voice-off">{{ t.settings.voiceOff }}</p>
      <p class="mt-2 text-xs leading-relaxed text-muted">{{ t.settings.aiNote }}</p>
    </section>

    <h2 :class="h2">{{ t.settings.mcpTitle }}</h2>
    <section class="rounded-xl bg-surface p-3 text-sm" data-testid="mcp-section">
      <p class="text-xs text-muted mb-3 leading-relaxed">{{ t.settings.mcpHint }}</p>

      <div v-if="!mcpTokens.length" class="text-xs text-muted py-1" data-testid="mcp-no-tokens">
        {{ t.settings.mcpNoKeys }}
      </div>

      <div v-for="tok in mcpTokens" :key="tok.id" class="mb-2 rounded-xl bg-bg p-3 border border-white/5" data-testid="mcp-token-row">
        <div class="flex items-baseline justify-between gap-2">
          <span class="text-sm font-semibold text-white" data-testid="mcp-token-name">{{ tok.name }}</span>
          <span class="font-mono text-xs text-muted">{{ tok.tokenPrefix }}...</span>
        </div>
        <div class="mt-1 text-xs text-muted">
          {{ tok.lastUsedAt ? t.settings.mcpLastUsed(formatDate(tok.lastUsedAt.slice(0, 10))) : t.settings.mcpNeverUsed }}
        </div>
        <div class="mt-2 flex gap-2">
          <template v-if="askRevoke !== tok.id">
            <button
              type="button"
              class="min-h-9 rounded-lg px-3 text-xs text-muted hover:text-danger-text"
              data-testid="mcp-revoke-btn"
              @click="askRevoke = tok.id"
            >
              {{ t.settings.mcpRevoke }}
            </button>
          </template>
          <template v-else>
            <span class="self-center text-xs text-danger-text">{{ t.settings.mcpRevokeConfirm(tok.name) }}</span>
            <button
              type="button"
              class="min-h-9 rounded-lg bg-danger px-3 text-xs font-bold text-on-danger"
              data-testid="mcp-revoke-confirm"
              @click="revokeToken(tok.id)"
            >
              {{ t.settings.mcpRevoke }}
            </button>
            <button
              type="button"
              class="min-h-9 rounded-lg px-3 text-xs text-muted"
              @click="askRevoke = null"
            >
              {{ t.common.keep }}
            </button>
          </template>
        </div>
      </div>

      <p v-if="mcpError" role="alert" class="mt-2 text-xs text-danger-text">{{ mcpError }}</p>

      <button
        type="button"
        class="mt-2 w-full rounded-xl border border-dashed border-white/15 py-2.5 text-xs font-semibold text-accent-text hover:border-accent-text"
        data-testid="create-mcp-key-btn"
        @click="mcpSheetOpen = true"
      >
        {{ t.settings.mcpCreateKey }}
      </button>
    </section>

    <McpKeySheet v-model:open="mcpSheetOpen" @created="loadMcpTokens" />

    <h2 id="reminders" :class="h2" class="scroll-mt-4">{{ t.settings.reminders }}</h2>
    <section data-testid="reminders-section">
      <p v-if="!reminders.length" class="rounded-xl bg-surface p-3 text-sm text-muted">{{ t.settings.noReminders }}</p>
      <div v-for="r in reminders" :key="r.id" class="mb-2 rounded-xl bg-surface p-3" data-testid="reminder-row">
        <div class="flex items-baseline justify-between gap-2">
          <span class="text-sm font-semibold text-white" data-testid="reminder-title">{{ r.title }}</span>
          <span class="text-xs text-muted">{{ r.bikeName ?? t.common.allBikes }}{{ r.repeatYearly ? t.settings.yearly : '' }}<span v-if="r.pending" class="text-warn-text">{{ t.settings.pendingSync }}</span></span>
        </div>
        <div v-if="r.provider || r.amountCents" class="mt-1 flex items-center gap-1.5 text-xs text-muted" data-testid="reminder-provider-amount">
          <span v-if="r.provider" class="font-medium text-text">{{ r.provider }}</span>
          <span v-if="r.provider && r.policyNumber" class="text-muted">({{ r.policyNumber }})</span>
          <span v-if="r.provider && r.amountCents">·</span>
          <span v-if="r.amountCents" class="font-tag font-bold text-accent-text">{{ formatMoney(r.amountCents) }}</span>
        </div>
        <div class="mt-0.5 text-xs" :class="when(r).tone" data-testid="reminder-when">{{ when(r).text }}</div>
        <div v-if="!r.pending" class="mt-2 flex gap-2">
          <template v-if="askRemove !== r.id">
            <button type="button" class="min-h-11 rounded-lg bg-bg px-4 text-[13px] font-semibold text-ok-text" data-testid="reminder-done" :disabled="acting" @click="act(r, 'done')">{{ t.settings.done }}</button>
            <button type="button" class="min-h-11 rounded-lg bg-bg px-3 text-[13px] font-semibold text-muted hover:text-white" data-testid="reminder-edit" :disabled="acting" @click="editReminder(r)">{{ t.common.edit }}</button>
            <button type="button" class="min-h-11 rounded-lg px-4 text-[13px] text-muted" data-testid="reminder-remove" :disabled="acting" @click="askRemove = r.id">{{ t.common.remove }}</button>
          </template>
          <template v-else>
            <span class="self-center text-[13px] text-text">{{ t.settings.removeAsk(r.title) }}</span>
            <button type="button" class="min-h-11 rounded-lg bg-danger px-4 text-[13px] font-bold text-on-danger" data-testid="reminder-remove-confirm" :disabled="acting" @click="act(r, 'remove')">{{ t.common.remove }}</button>
            <button type="button" class="min-h-11 rounded-lg px-4 text-[13px] text-muted" @click="askRemove = null">{{ t.common.keep }}</button>
          </template>
        </div>
      </div>
      <p v-if="remError" role="alert" class="mt-2 text-sm text-danger-text">{{ remError }}</p>
      <button type="button" class="mt-1 w-full rounded-xl border border-dashed border-white/15 py-3 text-sm font-semibold text-accent-text" data-testid="add-reminder" @click="openNewReminder">{{ t.settings.addReminder }}</button>
    </section>
    <ReminderSheet v-model:open="sheetOpen" :bikes="store.bikes" :initial-reminder="reminderToEdit" @saved="loadReminders" />

    <h2 :class="h2">{{ t.settings.account }}</h2>
    <section class="rounded-xl bg-surface p-3">
      <p class="text-sm text-muted">{{ t.settings.signedInAs }} <span class="text-white" data-testid="account-email">{{ email }}</span></p>
      <p v-if="pending" class="mt-2 text-xs text-warn-text" data-testid="sign-out-pending">
        {{ t.settings.unsynced(pending) }}
      </p>
      <button type="button" class="mt-2 w-full rounded-xl bg-bg py-3 text-sm font-semibold text-white" data-testid="sign-out" @click="signOut">{{ t.settings.signOut }}</button>
      <p v-if="signOutError" role="alert" class="mt-2 text-sm text-danger-text" data-testid="sign-out-error">{{ signOutError }}</p>
    </section>

    <NuxtLink
      v-if="isAdmin"
      to="/admin"
      class="mt-3 flex min-h-14 items-center justify-between gap-3 rounded-xl bg-surface p-3"
      data-testid="admin-link"
    >
      <span>
        <span class="block text-sm font-semibold text-white">{{ t.settings.admin }}</span>
        <span class="block text-xs text-muted">{{ t.settings.adminHint }}</span>
      </span>
      <span class="shrink-0 text-muted"><Icon name="chevron-right" /></span>
    </NuxtLink>

    <section class="mt-3 rounded-xl border border-danger/40 bg-surface p-3" data-testid="delete-account">
      <p class="text-sm font-semibold text-danger-text">{{ t.settings.deleteTitle }}</p>
      <p class="mt-1 text-xs text-muted">{{ t.settings.deleteHint }}</p>
      <label class="mt-3 block text-[11px] uppercase tracking-wider text-muted">
        {{ t.settings.typeDelete }}
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
        {{ t.settings.deleteTitle }}
      </button>
    </section>
  </main>
</template>
