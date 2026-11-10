import { overdueTotal, setBadge } from '~/lib/badge'

// The icon badge follows the garage: overdue items across all bikes, as of the last time the app loaded them.
export default defineNuxtPlugin(() => {
  const store = useBikesStore()
  watch(() => overdueTotal(store.bikes), (n) => void setBadge(navigator, n), { immediate: false })
})
