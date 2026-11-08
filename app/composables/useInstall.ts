import { isStandalone, onIos } from '~/lib/platform'

type InstallEvent = Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }

// Filled by plugins/install.client.ts: Chrome fires beforeinstallprompt once, early.
const deferred = shallowRef<InstallEvent | null>(null)
const installed = ref(false)

export function captureInstallPrompt(e: Event) {
  e.preventDefault()
  deferred.value = e as InstallEvent
}
export function markInstalled() {
  installed.value = true
  deferred.value = null
}

/** Install state: iOS needs Share → Add to Home Screen; Chrome/Android gets a real prompt. */
export function useInstall() {
  const standalone = ref(false)
  const ios = ref(false)
  onMounted(() => {
    standalone.value = isStandalone()
    ios.value = onIos()
  })
  const mode = computed<'installed' | 'ios' | 'prompt' | 'none'>(() => {
    if (standalone.value || installed.value) return 'installed'
    if (ios.value) return 'ios'
    return deferred.value ? 'prompt' : 'none'
  })
  async function install() {
    const e = deferred.value
    if (!e) return
    await e.prompt()
    const { outcome } = await e.userChoice
    if (outcome === 'accepted') markInstalled()
    else deferred.value = null // a prompt event can only be used once
  }
  return { mode, install }
}
