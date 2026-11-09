import { describe, expect, it } from 'vitest'
import { overlay } from '../../../app/offline/overlay'
import type { OutboxRow } from '../../../app/offline/db'

const row = (over: Partial<OutboxRow>): OutboxRow => ({ clientId: 'c', userId: 'u', url: '', method: 'POST', body: {}, createdAt: 0, label: '', attempts: 0, ...over })
const part = { id: 'p1', name: 'Junta escape', unit: 'pcs', qtyHundredths: 200, minHundredths: null, notes: null, bikeId: null, bikeName: null, itemIds: [] as string[] }

describe('overlay: parts', () => {
  it('applies a queued movement to the cached list row', () => {
    const rows = [row({ url: '/api/parts/p1/movements', body: { clientId: 'm1', qtyHundredths: -100 } })]
    const out = overlay('/api/parts', [part], rows) as Array<typeof part & { pending?: boolean }>
    expect(out[0]!.qtyHundredths).toBe(100)
  })
  it('stacks movements and applies them to the cached detail too', () => {
    const rows = [
      row({ url: '/api/parts/p1/movements', body: { qtyHundredths: -100 } }),
      row({ url: '/api/parts/p1/movements', body: { qtyHundredths: -100 } }),
      row({ url: '/api/parts/p2/movements', body: { qtyHundredths: 500 } }),
    ]
    expect((overlay('/api/parts/p1', { ...part, history: [] }, rows) as typeof part).qtyHundredths).toBe(0)
  })
  it('shows a queued new part with its starting count and bike name', () => {
    const rows = [row({ clientId: 'n1', url: '/api/parts', body: { name: 'Vela NGK', unit: 'pcs', qtyHundredths: 300, bikeId: 'b1' }, meta: { bikeName: 'KTM' } })]
    const out = overlay('/api/parts', [part], rows) as Array<Record<string, unknown>>
    expect(out).toHaveLength(2)
    expect(out[1]).toMatchObject({ id: 'pending-n1', name: 'Vela NGK', qtyHundredths: 300, bikeName: 'KTM', pending: true })
  })
  it('applies queued edits to the row', () => {
    const rows = [row({ method: 'PATCH', url: '/api/parts/p1', body: { name: 'Junta nova', minHundredths: 100 } })]
    expect(overlay('/api/parts', [part], rows)).toMatchObject([{ name: 'Junta nova', minHundredths: 100, qtyHundredths: 200 }])
  })
  it('lowers the cached count by the parts a queued service used', () => {
    const svc = row({ url: '/api/services', body: { bikeId: 'b1', partsUsed: [{ clientId: 'u1', partId: 'p1', qtyHundredths: 100 }, { clientId: 'u2', partId: 'p9', qtyHundredths: 50 }] } })
    const list = overlay('/api/parts', [part], [svc]) as Array<typeof part & { pendingSync?: boolean }>
    expect(list[0]!.qtyHundredths).toBe(100)
    expect(list[0]!.pendingSync).toBe(true)
    expect((overlay('/api/parts/p1', { ...part, history: [] }, [svc]) as typeof part).qtyHundredths).toBe(100)
    const both = overlay('/api/parts', [part], [svc, row({ url: '/api/parts/p1/movements', body: { qtyHundredths: -50 } })]) as Array<typeof part>
    expect(both[0]!.qtyHundredths).toBe(50)
  })
})
