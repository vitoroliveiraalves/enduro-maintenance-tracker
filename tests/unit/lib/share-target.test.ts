import { describe, expect, it } from 'vitest'
import { acceptShared, isFresh } from '../../../app/lib/share-target'

describe('share target', () => {
  it('keeps invoice-readable files, at most 5', () => {
    const f = (type: string) => ({ type })
    expect(acceptShared([f('image/jpeg'), f('video/mp4'), f('application/pdf'), f('image/png')])).toHaveLength(3)
    expect(acceptShared(Array.from({ length: 8 }, () => f('image/jpeg')))).toHaveLength(5)
  })
  it('forgets shares older than an hour', () => {
    const now = 10_000_000
    expect(isFresh(now - 59 * 60_000, now)).toBe(true)
    expect(isFresh(now - 61 * 60_000, now)).toBe(false)
    expect(isFresh(Number.NaN, now)).toBe(false)
  })
})
