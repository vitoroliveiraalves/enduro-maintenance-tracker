import { describe, expect, it, vi } from 'vitest'
import { ipAddressOptions } from '../../../server/utils/auth-ip'

describe('rate limiter client IP', () => {
  it('spoofed X-Forwarded-For values share one bucket', async () => {
    vi.stubEnv('AUTH_RATE_LIMIT_MAX', '3')
    vi.stubEnv('BETTER_AUTH_SECRET', 'unit-test-secret-unit-test-secret-123')
    vi.stubEnv('BETTER_AUTH_URL', 'http://localhost:3010')
    const { auth } = await import('../../../server/utils/auth')
    const statuses: number[] = []
    for (let i = 0; i < 6; i++) {
      const res = await auth.handler(
        new Request('http://localhost:3010/api/auth/sign-in/email', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            origin: 'http://localhost:3010',
            'x-real-ip': '203.0.113.7',
            'x-forwarded-for': `198.51.100.${i + 1}`,
          },
          body: JSON.stringify({ email: 'nobody@example.com', password: 'wrong-password' }),
        }),
      )
      statuses.push(res.status)
    }
    expect(statuses.slice(0, 3).every((s) => s !== 429)).toBe(true)
    expect(statuses.slice(3)).toEqual([429, 429, 429])
  })

  it('reads only the configured header unless trusted proxies are set', () => {
    expect(ipAddressOptions({}).ipAddressHeaders).toEqual(['x-real-ip'])
    expect(ipAddressOptions({ AUTH_IP_HEADER: 'CF-Connecting-IP' }).ipAddressHeaders).toEqual(['cf-connecting-ip'])
    const t = ipAddressOptions({ AUTH_TRUSTED_PROXIES: '10.0.0.0/8, 127.0.0.1' })
    expect(t.trustedProxies).toEqual(['10.0.0.0/8', '127.0.0.1'])
    expect(t.ipAddressHeaders).toContain('x-forwarded-for')
  })

  it('warns loudly in production when nothing is configured', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    ipAddressOptions({ NODE_ENV: 'production' })
    expect(warn).toHaveBeenCalledOnce()
    ipAddressOptions({ NODE_ENV: 'production', AUTH_IP_HEADER: 'x-real-ip' })
    expect(warn).toHaveBeenCalledOnce()
    warn.mockRestore()
  })
})
