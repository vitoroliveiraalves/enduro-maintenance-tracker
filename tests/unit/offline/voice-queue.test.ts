import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearOfflineData } from '../../../app/offline/db'
import { flushVoice, listVoice, queueVoice } from '../../../app/offline/voice'

beforeEach(async () => {
  await clearOfflineData()
})

describe('offline voice queue', () => {
  it('two flushes at once send a waiting note only once', async () => {
    await queueVoice(new ArrayBuffer(64), 'u1')
    let release!: () => void
    const send = vi.fn(() => new Promise((r) => (release = () => r({ transcript: 't', answer: null, sources: [], proposals: [], notes: [] }))))
    const a = flushVoice(send, 'u1')
    const b = flushVoice(send, 'u1')
    await vi.waitFor(() => expect(send).toHaveBeenCalled())
    release()
    await Promise.all([a, b])
    expect(send).toHaveBeenCalledTimes(1)
    const [row] = await listVoice()
    expect(row!.result).toMatchObject({ transcript: 't' })
    expect(row!.data.byteLength).toBe(0)
  })

  it("never sends another rider's note", async () => {
    await queueVoice(new ArrayBuffer(64), 'u1')
    const send = vi.fn(async () => ({}))
    await flushVoice(send, 'u2')
    expect(send).not.toHaveBeenCalled()
  })
})
