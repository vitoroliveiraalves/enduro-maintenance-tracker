import { captureInstallPrompt, markInstalled } from '~/composables/useInstall'

export default defineNuxtPlugin(() => {
  window.addEventListener('beforeinstallprompt', captureInstallPrompt)
  window.addEventListener('appinstalled', markInstalled)
})
