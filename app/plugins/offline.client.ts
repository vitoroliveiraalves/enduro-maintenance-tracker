import { startOfflineSync } from '~/composables/useOffline'

// Outbox replay on app start, `online` and foreground (Task 12).
export default defineNuxtPlugin(() => {
  startOfflineSync()
})
