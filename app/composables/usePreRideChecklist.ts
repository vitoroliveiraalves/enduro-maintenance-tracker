import { ref, computed, toRef, type MaybeRefOrGetter } from 'vue'
import type { Messages } from '~/i18n/en'

export type ChecklistItemConfig = {
  id: string
  label: string
  hint?: string
  enabled: boolean
  isCustom?: boolean
}

export type PreRideConfig = {
  enabled: boolean
  lastCheckedAt: string | null
  items?: ChecklistItemConfig[]
}

const STORAGE_PREFIX = 'enduro:preride:'
const checklistTick = ref(0)

export function getDefaultChecklistItems(isCar: boolean, t: Messages): ChecklistItemConfig[] {
  if (isCar) {
    return [
      { id: 'tires', label: t.checklist.car.tires, hint: t.checklist.car.tiresHint, enabled: true },
      { id: 'fluids', label: t.checklist.car.fluids, hint: t.checklist.car.fluidsHint, enabled: true },
      { id: 'lights', label: t.checklist.car.lights, hint: t.checklist.car.lightsHint, enabled: true },
      { id: 'brakes', label: t.checklist.car.brakes, hint: t.checklist.car.brakesHint, enabled: true },
      { id: 'wipers', label: t.checklist.car.wipers, hint: t.checklist.car.wipersHint, enabled: true },
    ]
  }
  return [
    { id: 'tires', label: t.checklist.moto.tires, hint: t.checklist.moto.tiresHint, enabled: true },
    { id: 'fluids', label: t.checklist.moto.fluids, hint: t.checklist.moto.fluidsHint, enabled: true },
    { id: 'chain', label: t.checklist.moto.chain, hint: t.checklist.moto.chainHint, enabled: true },
    { id: 'controls', label: t.checklist.moto.controls, hint: t.checklist.moto.controlsHint, enabled: true },
    { id: 'bolts', label: t.checklist.moto.bolts, hint: t.checklist.moto.boltsHint, enabled: true },
    { id: 'fuel', label: t.checklist.moto.fuel, hint: t.checklist.moto.fuelHint, enabled: true },
  ]
}

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
      const items = Array.isArray(parsed.items)
        ? parsed.items.map((it: Record<string, unknown>) => ({
            id: String(it.id),
            label: String(it.label || ''),
            hint: it.hint ? String(it.hint) : undefined,
            enabled: Boolean(it.enabled),
            isCustom: Boolean(it.isCustom),
          }))
        : undefined
      return {
        enabled: Boolean(parsed.enabled),
        lastCheckedAt: typeof parsed.lastCheckedAt === 'string' ? parsed.lastCheckedAt : null,
        items,
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

  function getEffectiveItems(isCar: boolean, t: Messages): ChecklistItemConfig[] {
    const custom = config.value.items
    if (custom && custom.length > 0) return custom
    return getDefaultChecklistItems(isCar, t)
  }

  function saveItems(items: ChecklistItemConfig[]) {
    const cur = readConfig(idRef.value)
    writeConfig(idRef.value, { ...cur, items })
  }

  function resetItems() {
    const cur = readConfig(idRef.value)
    const next: PreRideConfig = { enabled: cur.enabled, lastCheckedAt: cur.lastCheckedAt }
    writeConfig(idRef.value, next)
  }

  return {
    config,
    setEnabled,
    markChecked,
    isDue,
    getEffectiveItems,
    saveItems,
    resetItems,
  }
}
