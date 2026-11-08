import { defineStore } from 'pinia'
import type { BikeSummary } from '../../server/domain/item-row'

const KEY = 'enduro:lastBike'

function readLast(): string | null {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

export const useBikesStore = defineStore('bikes', () => {
  const { get } = useApi()
  const bikes = ref<BikeSummary[]>([])
  /** Bikes added offline, waiting for the outbox (no server id yet: shown, not openable). */
  const pendingBikes = ref<Array<{ id: string; name: string }>>([])
  const loaded = ref(false)
  const lastBikeId = ref<string | null>(readLast())

  async function fetchBikes() {
    const all = await get<Array<BikeSummary & { pending?: boolean }>>('/api/bikes')
    bikes.value = all.filter((b) => !b.pending)
    pendingBikes.value = all.filter((b) => b.pending)
    loaded.value = true
    // Forget a last bike that no longer exists.
    if (lastBikeId.value && !bikes.value.some((b) => b.id === lastBikeId.value)) setLast(null)
  }

  function setLast(id: string | null) {
    lastBikeId.value = id
    try {
      if (id) localStorage.setItem(KEY, id)
      else localStorage.removeItem(KEY)
    } catch {
      // storage unavailable: the tab just falls back to the garage
    }
  }

  return { bikes, pendingBikes, loaded, lastBikeId, fetchBikes, setLast }
})
