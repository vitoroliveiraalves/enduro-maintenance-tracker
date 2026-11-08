import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref, computed } from 'vue'

const fetchMock = vi.fn(async (_url: string, _opts?: unknown) => ({ ok: true }))
vi.stubGlobal('$fetch', fetchMock)
vi.stubGlobal('ref', ref)
vi.stubGlobal('computed', computed)

const { useApi } = await import('../../../app/composables/useApi')

beforeEach(() => fetchMock.mockClear())

describe('useApi.mutate', () => {
  it('adds a clientId to JSON bodies when missing', async () => {
    await useApi().mutate('/api/x', { a: 1 })
    const body = (fetchMock.mock.calls[0]![1] as { body: { a: number; clientId: string } }).body
    expect(body.a).toBe(1)
    expect(body.clientId).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('keeps an existing clientId', async () => {
    await useApi().mutate('/api/x', { clientId: 'mine' })
    expect((fetchMock.mock.calls[0]![1] as { body: { clientId: string } }).body.clientId).toBe('mine')
  })

  it('passes FormData through untouched', async () => {
    const fd = new FormData()
    await useApi().mutate('/api/x', fd)
    const body = (fetchMock.mock.calls[0]![1] as { body: unknown }).body
    expect(body).toBe(fd)
    expect(fd.has('clientId')).toBe(false)
  })

  it('defaults to POST and honours opts.method', async () => {
    await useApi().mutate('/api/x', {})
    expect((fetchMock.mock.calls[0]![1] as { method: string }).method).toBe('POST')
    await useApi().mutate('/api/x', {}, { method: 'PATCH' })
    expect((fetchMock.mock.calls[1]![1] as { method: string }).method).toBe('PATCH')
  })
})
