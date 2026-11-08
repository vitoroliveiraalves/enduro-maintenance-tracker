import { describe, expect, it } from 'vitest'
import { assertReadAllowed, DAILY_LIMIT_COPY, GLOBAL_DAILY_CAP, rateLimit } from '../../../server/utils/rate-limit'

describe('rateLimit', () => {
  it('allows up to max hits per window, then returns the wait until the oldest expires', () => {
    const key = `t-${Math.random()}`
    const t0 = 1_000_000
    for (let i = 0; i < 3; i++) expect(rateLimit(key, 3, 60_000, t0 + i)).toBeNull()
    expect(rateLimit(key, 3, 60_000, t0 + 10)).toBe(60_000 - 10)
    expect(rateLimit(key, 3, 60_000, t0 + 60_001)).toBeNull()
  })

  it('keys are independent (per user)', () => {
    const a = `a-${Math.random()}`
    const b = `b-${Math.random()}`
    expect(rateLimit(a, 1, 1000, 5)).toBeNull()
    expect(rateLimit(a, 1, 1000, 6)).not.toBeNull()
    expect(rateLimit(b, 1, 1000, 6)).toBeNull()
  })
})

describe('assertReadAllowed', () => {
  it('the 31st read in a day is a 429 with the daily-limit copy', () => {
    const user = `u-${Math.random()}`
    const t0 = Date.UTC(2026, 10, 8, 8)
    // 30 reads spread over the day (never 60 in 10 minutes)
    for (let i = 0; i < 30; i++) expect(() => assertReadAllowed(user, 30, t0 + i * 20 * 60_000)).not.toThrow()
    let err: { statusCode?: number; statusMessage?: string } = {}
    try {
      assertReadAllowed(user, 30, t0 + 30 * 20 * 60_000)
    } catch (e) {
      err = e as typeof err
    }
    expect(err.statusCode).toBe(429)
    expect(err.statusMessage).toBe('Daily invoice reading limit reached — you can still add the lines yourself.')
    expect(DAILY_LIMIT_COPY).toBe(err.statusMessage)
    // a day later the user can read again
    expect(() => assertReadAllowed(user, 30, t0 + 25 * 3_600_000 + 30 * 20 * 60_000)).not.toThrow()
  })

  it('more than 60 reads in 10 minutes is a 429 even under the daily cap', () => {
    const user = `u-${Math.random()}`
    const t0 = 5_000_000
    for (let i = 0; i < 60; i++) assertReadAllowed(user, 1000, t0 + i)
    expect(() => assertReadAllowed(user, 1000, t0 + 61)).toThrow(/Too many invoice reads/)
  })

  it('a blocked read does not use up the daily allowance', () => {
    const user = `u-${Math.random()}`
    const t0 = 9_000_000
    for (let i = 0; i < 60; i++) assertReadAllowed(user, 1000, t0 + i)
    for (let i = 0; i < 5; i++) expect(() => assertReadAllowed(user, 1000, t0 + 100 + i)).toThrow()
    // window passed: allowed again
    expect(() => assertReadAllowed(user, 1000, t0 + 10 * 60_000 + 100)).not.toThrow()
  })
})

describe('global daily ceiling', () => {
  it('defaults to 300 a day across all users; past it every user gets the busy copy, before their own caps', () => {
    expect(GLOBAL_DAILY_CAP).toBe(300)
    const t0 = Date.UTC(2031, 0, 1)
    for (let i = 0; i < 3; i++) assertReadAllowed(`g-${i}-${Math.random()}`, 30, t0 + i, 3)
    let err: { statusCode?: number; statusMessage?: string } = {}
    try {
      assertReadAllowed(`fresh-${Math.random()}`, 30, t0 + 10, 3)
    } catch (e) {
      err = e as typeof err
    }
    expect(err).toMatchObject({ statusCode: 429, statusMessage: 'Invoice reading is busy today — you can still add the lines yourself.' })
    // a day later reading is open again
    expect(() => assertReadAllowed(`fresh-${Math.random()}`, 30, t0 + 86_400_000 + 10, 3)).not.toThrow()
  })
})
