import { describe, expect, it, vi } from 'vitest'

const sendNotification = vi.fn(async () => ({}))
vi.mock('web-push', () => ({ default: { sendNotification } }))

const { PUSH_TIMEOUT_MS, webPushSender } = await import('../../../server/utils/push')

describe('webPushSender', () => {
  it('gives the push service 10 s, so one slow endpoint cannot hang the hourly run', async () => {
    expect(PUSH_TIMEOUT_MS).toBe(10_000)
    const v = { publicKey: 'pub', privateKey: 'priv', subject: 'mailto:a@example.com' }
    await webPushSender(v)({ endpoint: 'https://fcm.googleapis.com/x', p256dh: 'p', auth: 'a' } as never, '{}')
    expect(sendNotification).toHaveBeenCalledWith(expect.objectContaining({ endpoint: 'https://fcm.googleapis.com/x' }), '{}', expect.objectContaining({ timeout: 10_000, vapidDetails: v }))
  })
})
