import { describe, expect, it } from 'vitest'
import { checkProductionEnv } from '../../../server/utils/env-check'

const good = {
  BETTER_AUTH_SECRET: 'x'.repeat(48),
  BETTER_AUTH_URL: 'https://enduro.example.org',
  NUXT_VAPID_PUBLIC_KEY: 'pub',
  NUXT_VAPID_PRIVATE_KEY: 'priv',
  NUXT_VAPID_SUBJECT: 'mailto:ops@enduro.example.org',
  NUXT_OPENROUTER_API_KEY: 'k',
}

describe('checkProductionEnv', () => {
  it('a complete production env passes with no warnings', () => {
    expect(checkProductionEnv(good)).toEqual({ errors: [], warnings: [] })
  })

  it('refuses a missing, placeholder or short secret, and a missing public URL', () => {
    expect(checkProductionEnv({ ...good, BETTER_AUTH_SECRET: undefined }).errors).toHaveLength(1)
    expect(checkProductionEnv({ ...good, BETTER_AUTH_SECRET: 'change-me-to-a-long-random-string' }).errors[0]).toMatch(/placeholder/)
    expect(checkProductionEnv({ ...good, BETTER_AUTH_SECRET: 'short' }).errors[0]).toMatch(/32/)
    expect(checkProductionEnv({ ...good, BETTER_AUTH_URL: '' }).errors[0]).toMatch(/BETTER_AUTH_URL/)
    expect(checkProductionEnv({ ...good, DATABASE_URL: 'postgres://enduro:change-me-hex-only@db:5432/enduro' }).errors[0]).toMatch(/POSTGRES_PASSWORD/)
  })

  it('only warns for plain http on a public host, missing push or AI keys, placeholder VAPID subject', () => {
    const r = checkProductionEnv({ ...good, BETTER_AUTH_URL: 'http://enduro.example.org', NUXT_VAPID_SUBJECT: 'mailto:you@example.com', NUXT_OPENROUTER_API_KEY: '' })
    expect(r.errors).toEqual([])
    expect(r.warnings).toHaveLength(3)
    expect(checkProductionEnv({ ...good, BETTER_AUTH_URL: 'http://localhost:3210' }).warnings).toEqual([])
  })
})
