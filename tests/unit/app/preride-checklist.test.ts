import { describe, expect, it, beforeEach } from 'vitest'
import { usePreRideChecklist } from '../../../app/composables/usePreRideChecklist'

const mem = new Map<string, string>()
// @ts-expect-error mock localStorage in node
globalThis.localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => void mem.clear(),
}

describe('usePreRideChecklist', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('starts disabled by default and is not due', () => {
    const { config, isDue } = usePreRideChecklist('bike-1')
    expect(config.value.enabled).toBe(false)
    expect(config.value.lastCheckedAt).toBeNull()
    expect(isDue('2026-11-10T10:00:00Z')).toBe(false)
  })

  it('when enabled, becomes due after a ride if never checked', () => {
    const { config, setEnabled, isDue } = usePreRideChecklist('bike-1')
    setEnabled(true)
    expect(config.value.enabled).toBe(true)
    expect(isDue(null)).toBe(false) // no ride logged
    expect(isDue('2026-11-10T10:00:00Z')).toBe(true) // ride logged
  })

  it('clears due status after marking checked', () => {
    const { setEnabled, isDue, markChecked } = usePreRideChecklist('bike-1')
    setEnabled(true)
    const rideTime = '2026-11-10T10:00:00Z'
    expect(isDue(rideTime)).toBe(true)

    markChecked()
    expect(isDue(rideTime)).toBe(false) // checked after the ride!

    // If another ride happens in the future:
    const futureRide = new Date(Date.now() + 60000).toISOString()
    expect(isDue(futureRide)).toBe(true)
  })

  it('remains not due when disabled even if rides are logged', () => {
    const { setEnabled, isDue } = usePreRideChecklist('bike-1')
    setEnabled(false)
    expect(isDue('2026-11-10T10:00:00Z')).toBe(false)
  })
})
