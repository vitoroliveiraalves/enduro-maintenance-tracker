import { describe, expect, it, vi } from 'vitest'
import { overdueTotal, setBadge } from '../../../app/lib/badge'

describe('app badge', () => {
  it('sums overdue items over all bikes', () => {
    expect(overdueTotal([{ counts: { overdue: 2 } }, { counts: { overdue: 0 } }, { counts: { overdue: 1 } }])).toBe(3)
    expect(overdueTotal([])).toBe(0)
  })
  it('sets above zero, clears at zero, and ignores missing support or errors', async () => {
    const nav = { setAppBadge: vi.fn().mockResolvedValue(undefined), clearAppBadge: vi.fn().mockResolvedValue(undefined) }
    await setBadge(nav, 3)
    expect(nav.setAppBadge).toHaveBeenCalledWith(3)
    await setBadge(nav, 0)
    expect(nav.clearAppBadge).toHaveBeenCalled()
    await expect(setBadge({}, 2)).resolves.toBeUndefined()
    await expect(setBadge({ setAppBadge: () => Promise.reject(new Error('denied')) }, 2)).resolves.toBeUndefined()
  })
})
