import { ref, computed, toRef, type MaybeRefOrGetter } from 'vue'

export type PreRideConfig = {
  enabled: boolean
  lastCheckedAt: string | null
}

const STORAGE_PREFIX = 'enduro:preride:'
const checklistTick = ref(0)

export function usePreRideChecklist(bikeId: MaybeRefOrGetter<string>) {
  const idRef = toRef(bikeId)

  function key(id: string) {
    return `${STORAGE_PREFIX}${id}`
  }

  function readConfig(id: string): PreRideConfig {
    if (typeof localStorage === 'undefined' || !id) return { enabled: false, lastCheckedAt: null }
    try {
      const raw = localStorage.getItem(key(id))
      if (!raw) return { enabled: false, lastCheckedAt: null }
      const parsed = JSON.parse(raw)
      return {
        enabled: Boolean(parsed.enabled),
        lastCheckedAt: typeof parsed.lastCheckedAt === 'string' ? parsed.lastCheckedAt : null,
      }
    } catch {
      return { enabled: false, lastCheckedAt: null }
    }
  }

  function writeConfig(id: string, val: PreRideConfig) {
    if (typeof localStorage === 'undefined' || !id) return
    try {
      localStorage.setItem(key(id), JSON.stringify(val))
      checklistTick.value++
    } catch {
      // storage unavailable or full
    }
  }

  const config = computed<PreRideConfig>(() => {
    // depend on checklistTick for reactivity
    void checklistTick.value
    return readConfig(idRef.value)
  })

  function setEnabled(enabled: boolean) {
    const cur = readConfig(idRef.value)
    writeConfig(idRef.value, { ...cur, enabled })
  }

  function markChecked() {
    const cur = readConfig(idRef.value)
    writeConfig(idRef.value, { ...cur, lastCheckedAt: new Date().toISOString() })
  }

  function isDue(latestReadingAt?: string | null): boolean {
    if (!config.value.enabled) return false
    if (!latestReadingAt) return false
    if (!config.value.lastCheckedAt) return true
    return new Date(latestReadingAt).getTime() > new Date(config.value.lastCheckedAt).getTime()
  }

  return {
    config,
    setEnabled,
    markChecked,
    isDue,
  }
}
