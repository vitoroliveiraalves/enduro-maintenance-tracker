import { describe, expect, it } from 'vitest'
import { assertTestDatabase } from '../../support/truncate'

describe('test database guard (final review #10)', () => {
  it('workers get the *_test database from vitest.config.ts', async () => {
    expect(process.env.DATABASE_URL).toMatch(/\/enduro_test$/)
    expect(process.env.NUXT_DATABASE_URL).toMatch(/\/enduro_test$/)
    await expect(assertTestDatabase()).resolves.toBeUndefined()
  })

  it('refuses to wipe a database whose name does not end in _test', async () => {
    const { vi } = await import('vitest')
    vi.resetModules()
    vi.doMock('../../../server/db/client', () => ({ db: { execute: async () => [{ name: 'enduro' }] } }))
    const guard = await import('../../support/truncate')
    await expect(guard.truncateUsers()).rejects.toThrow(/Refusing to wipe database "enduro"/)
    vi.doUnmock('../../../server/db/client')
  })
})
