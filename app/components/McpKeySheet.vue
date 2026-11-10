<script setup lang="ts">
const { t } = useI18n()
const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ (e: 'created'): void }>()

const { mutate } = useApi()
const toast = useToast()

const name = ref('')
const loading = ref(false)
const error = ref('')
const createdToken = ref<string | null>(null)
const activeTab = ref<'claude' | 'gemini' | 'cursor'>('claude')
const copied = ref(false)

const origin = computed(() => {
  if (import.meta.client && typeof window !== 'undefined') {
    return window.location.origin
  }
  return 'https://your-domain.com'
})

watch(open, (isOpen) => {
  if (isOpen) {
    name.value = ''
    error.value = ''
    createdToken.value = null
    copied.value = false
    activeTab.value = 'claude'
  }
})

async function submit() {
  if (!name.value.trim() || loading.value) return
  loading.value = true
  error.value = ''
  try {
    const res = await mutate<{ token: string }>('/api/tokens', { name: name.value.trim() })
    createdToken.value = res.token
    emit('created')
  } catch {
    error.value = t.value.settings.mcpCreatedFailed
  } finally {
    loading.value = false
  }
}

const claudeConfig = computed(() => {
  if (!createdToken.value) return ''
  return JSON.stringify(
    {
      mcpServers: {
        'dirt-garage': {
          command: 'npx',
          args: [
            '-y',
            'mcp-remote',
            `${origin.value}/api/mcp/sse`,
            '--header',
            `Authorization: Bearer ${createdToken.value}`,
          ],
        },
      },
    },
    null,
    2,
  )
})

const cursorConfig = computed(() => {
  if (!createdToken.value) return ''
  return JSON.stringify(
    {
      mcpServers: {
        'dirt-garage': {
          url: `${origin.value}/api/mcp/sse`,
          headers: {
            Authorization: `Bearer ${createdToken.value}`,
          },
        },
      },
    },
    null,
    2,
  )
})

const sseUrl = computed(() => `${origin.value}/api/mcp/sse`)

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    copied.value = true
    toast.show(t.value.settings.mcpCopied)
    setTimeout(() => {
      copied.value = false
    }, 2000)
  } catch {
    // clipboard fallback
  }
}
</script>

<template>
  <Sheet v-model:open="open" :title="t.settings.mcpTitle" testid="mcp-sheet">
    <div v-if="!createdToken" class="p-4">
      <p class="mb-4 text-xs text-muted leading-relaxed">
        {{ t.settings.mcpHint }}
      </p>

      <form @submit.prevent="submit">
        <label class="block text-xs font-semibold text-muted uppercase tracking-wider mb-1">
          {{ t.settings.mcpKeyName }}
        </label>
        <input
          v-model="name"
          type="text"
          class="w-full rounded-xl border border-white/10 bg-bg px-3 py-2.5 text-sm text-white focus:border-accent-text focus:outline-none"
          :placeholder="t.settings.mcpKeyNamePlaceholder"
          maxlength="50"
          autofocus
          data-testid="mcp-token-name-input"
        >

        <p v-if="error" class="mt-2 text-xs text-danger-text" role="alert" data-testid="mcp-token-error">
          {{ error }}
        </p>

        <div class="mt-5 flex gap-2">
          <button
            type="submit"
            class="flex-1 rounded-xl bg-accent-text py-3 text-sm font-bold text-on-accent disabled:opacity-50"
            :disabled="!name.trim() || loading"
            data-testid="mcp-token-submit"
          >
            {{ t.settings.mcpCreate }}
          </button>
          <button
            type="button"
            class="rounded-xl px-4 py-3 text-sm font-semibold text-muted"
            @click="open = false"
          >
            {{ t.settings.mcpCancel }}
          </button>
        </div>
      </form>
    </div>

    <!-- Success & Configuration Step -->
    <div v-else class="p-4" data-testid="mcp-token-success">
      <div class="rounded-xl border border-warn-text/40 bg-warn-bg/20 p-3 text-xs text-warn-text mb-4">
        ⚠️ {{ t.settings.mcpSecretWarning }}
      </div>

      <div class="mb-4">
        <label class="block text-xs font-semibold text-muted uppercase tracking-wider mb-1">
          Access Token
        </label>
        <div class="flex items-center gap-2 rounded-xl border border-white/10 bg-bg p-2.5">
          <code class="flex-1 font-mono text-xs text-white break-all" data-testid="mcp-raw-token">
            {{ createdToken }}
          </code>
          <button
            type="button"
            class="rounded-lg bg-surface px-3 py-1.5 text-xs font-semibold text-accent-text hover:bg-surface-hover shrink-0"
            data-testid="mcp-copy-token"
            @click="copyText(createdToken!)"
          >
            {{ copied ? t.settings.mcpCopied : t.common.copy }}
          </button>
        </div>
      </div>

      <!-- Client Config Tabs -->
      <div class="flex rounded-xl border border-white/10 bg-bg p-1 text-xs font-semibold mb-3">
        <button
          type="button"
          class="flex-1 rounded-lg py-1.5 transition-colors"
          :class="activeTab === 'claude' ? 'bg-surface text-white' : 'text-muted hover:text-white'"
          @click="activeTab = 'claude'"
        >
          Claude Desktop
        </button>
        <button
          type="button"
          class="flex-1 rounded-lg py-1.5 transition-colors"
          :class="activeTab === 'gemini' ? 'bg-surface text-white' : 'text-muted hover:text-white'"
          @click="activeTab = 'gemini'"
        >
          Gemini Mobile
        </button>
        <button
          type="button"
          class="flex-1 rounded-lg py-1.5 transition-colors"
          :class="activeTab === 'cursor' ? 'bg-surface text-white' : 'text-muted hover:text-white'"
          @click="activeTab = 'cursor'"
        >
          Cursor / IDE
        </button>
      </div>

      <!-- Tab: Claude -->
      <div v-if="activeTab === 'claude'" class="mb-4">
        <div class="flex items-center justify-between mb-1.5">
          <span class="text-[11px] text-muted">Add to <code>claude_desktop_config.json</code>:</span>
          <button
            type="button"
            class="text-xs font-semibold text-accent-text"
            @click="copyText(claudeConfig)"
          >
            {{ t.settings.mcpCopyConfig }}
          </button>
        </div>
        <pre class="max-h-40 overflow-x-auto rounded-xl bg-bg p-3 font-mono text-[11px] text-white/90 border border-white/10">{{ claudeConfig }}</pre>
      </div>

      <!-- Tab: Gemini Mobile -->
      <div v-else-if="activeTab === 'gemini'" class="mb-4 space-y-3">
        <div>
          <div class="flex items-center justify-between mb-1">
            <span class="text-[11px] text-muted">Remote MCP Server URL:</span>
            <button
              type="button"
              class="text-xs font-semibold text-accent-text"
              @click="copyText(sseUrl)"
            >
              {{ t.common.copy }}
            </button>
          </div>
          <input
            readonly
            :value="sseUrl"
            class="w-full rounded-xl border border-white/10 bg-bg px-3 py-2 text-xs font-mono text-white focus:outline-none"
          >
        </div>
        <p class="text-[11px] text-muted leading-relaxed">
          In Gemini, connect your app by entering the URL above and pasting your Bearer token in the authentication header.
        </p>
      </div>

      <!-- Tab: Cursor -->
      <div v-else-if="activeTab === 'cursor'" class="mb-4">
        <div class="flex items-center justify-between mb-1.5">
          <span class="text-[11px] text-muted">Add to <code>.cursor/mcp.json</code>:</span>
          <button
            type="button"
            class="text-xs font-semibold text-accent-text"
            @click="copyText(cursorConfig)"
          >
            {{ t.settings.mcpCopyConfig }}
          </button>
        </div>
        <pre class="max-h-40 overflow-x-auto rounded-xl bg-bg p-3 font-mono text-[11px] text-white/90 border border-white/10">{{ cursorConfig }}</pre>
      </div>

      <button
        type="button"
        class="w-full rounded-xl bg-accent-text py-3 text-sm font-bold text-on-accent"
        data-testid="mcp-token-done"
        @click="open = false"
      >
        {{ t.settings.mcpDone }}
      </button>
    </div>
  </Sheet>
</template>
