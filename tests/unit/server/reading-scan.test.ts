import { describe, expect, it, vi } from 'vitest'
import type { Bike } from '../../../server/db/schema'
import { assertScanAllowed } from '../../../server/utils/rate-limit'
import { scanReading, type ScanCfg } from '../../../server/utils/reading-scan'

const dummyBike = (meters: Bike['meters'] = 'hours_km'): Bike => ({
  id: 'b1',
  userId: 'u1',
  clientId: null,
  name: 'KTM 300',
  make: 'KTM',
  model: '300 EXC',
  year: 2023,
  stroke: '2T',
  meters,
  photoDocumentId: null,
  archivedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
})

const mockCfg: ScanCfg = {
  apiKey: '',
  model: 'google/gemini-3.1-flash-lite',
  reader: 'mock',
  dailyCap: 60,
  globalDailyCap: 600,
}

const jpeg = (extra = '') => ({
  mime: 'image/jpeg',
  data: Buffer.from(`\xFF\xD8\xFF${extra}`),
})

describe('scanReading', () => {
  it('mock mode returns plausible reading incremented from last reading', async () => {
    const bike = dummyBike('hours_km')
    const res = await scanReading(jpeg(), bike, { hoursTenths: 1400, km: 3800 }, mockCfg)
    expect(res).toEqual({ hours: 142.5, km: 3845, confidence: 'high' })
  })

  it('mock mode only populates counted meters', async () => {
    const hoursOnly = dummyBike('hours')
    const resH = await scanReading(jpeg(), hoursOnly, { hoursTenths: 100, km: null }, mockCfg)
    expect(resH.hours).toBe(12.5)
    expect(resH.km).toBeNull()

    const kmOnly = dummyBike('km')
    const resK = await scanReading(jpeg(), kmOnly, { hoursTenths: null, km: 500 }, mockCfg)
    expect(resK.hours).toBeNull()
    expect(resK.km).toBe(545)
  })

  it('mock mode returns unreadable for MOCK-FAIL', async () => {
    const res = await scanReading(jpeg('MOCK-FAIL'), dummyBike(), null, mockCfg)
    expect(res).toEqual({ hours: null, km: null, confidence: 'unreadable' })
  })

  it('parses valid model response and respects bike meters', async () => {
    const apiCfg: ScanCfg = { ...mockCfg, apiKey: 'sk-test', reader: '' }
    const modelOutput = { hours: 155.6, km: 4120, confidence: 'high' }
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(modelOutput) } }] }), { status: 200 }))

    const res = await scanReading(jpeg(), dummyBike('hours'), null, apiCfg, fetchImpl as unknown as typeof fetch)
    expect(res).toEqual({ hours: 155.6, km: null, confidence: 'high' })
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it('throws 502 when OpenRouter fails', async () => {
    const apiCfg: ScanCfg = { ...mockCfg, apiKey: 'sk-test', reader: '' }
    const fetchImpl = vi.fn(async () => new Response('Internal error', { status: 500 }))

    await expect(scanReading(jpeg(), dummyBike(), null, apiCfg, fetchImpl as unknown as typeof fetch)).rejects.toMatchObject({
      statusCode: 502,
    })
  })
})

describe('assertScanAllowed', () => {
  it('enforces daily cap', () => {
    const uid = 'scan-user-1'
    const now = Date.now()
    assertScanAllowed(uid, 2, now, 100)
    assertScanAllowed(uid, 2, now + 1, 100)
    expect(() => assertScanAllowed(uid, 2, now + 2, 100)).toThrowError(/Daily scan limit reached/)
  })
})
