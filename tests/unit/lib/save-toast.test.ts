import { describe, expect, it } from 'vitest'
import { rideToast } from '~/lib/save-toast'

const T = String.fromCharCode(0x202f)
const it_ = (name: string, state: string) => ({ id: name, name, status: { state } })

describe('rideToast', () => {
  it('confirms the meters and names items that just crossed into overdue/soon', () => {
    const before = [it_('Air filter clean', 'ok'), it_('Gearbox oil', 'soon'), it_('Chain', 'ok')]
    const after = [it_('Air filter clean', 'overdue'), it_('Gearbox oil', 'soon'), it_('Chain', 'soon')]
    expect(rideToast(before, { hoursTenths: 1450, km: 3880 }, after, false)).toBe(`Ride saved · 145.0 h · 3${T}880 km · Air filter clean now overdue · Chain due soon`)
  })
  it('nothing changed → just the meters', () => {
    expect(rideToast([it_('A', 'ok')], { hoursTenths: 1450, km: 3880 }, [it_('A', 'ok')], false)).toBe(`Ride saved · 145.0 h · 3${T}880 km`)
  })
  it('offline: says it will sync', () => {
    expect(rideToast([], { hoursTenths: 1450, km: 3880 }, [], true)).toBe(`Ride saved on this phone · 145.0 h · 3${T}880 km · syncs when online`)
  })
  it('km-only bike: only km, never hours', () => {
    const t = rideToast([], { hoursTenths: null, km: 3812 }, [], false)
    expect(t).toBe(`Ride saved · 3${T}812 km`)
    expect(rideToast([], { hoursTenths: 1450, km: null }, [], true)).toBe('Ride saved on this phone · 145.0 h · syncs when online')
  })
})
