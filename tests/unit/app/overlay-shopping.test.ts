import { describe, expect, it } from 'vitest'
import { overlay } from '../../../app/offline/overlay'
import type { OutboxRow } from '../../../app/offline/db'

const row = (over: Partial<OutboxRow>): OutboxRow => ({ clientId: 'c', userId: 'u', url: '', method: 'POST', body: {}, createdAt: 1_700_000_000_000, label: '', attempts: 0, ...over })
const list = () => ({
  auto: [{ key: 'min:p1', partId: 'p1', partName: 'Oil', unit: 'pcs', bikeId: null, bikeName: null, reason: 'min', detail: 'keep 2, have 1' }],
  manual: [{ id: 'm1', text: 'Chain lube', bikeId: null, bikeName: null, partId: null, doneAt: null }],
})
type Manual = ReturnType<typeof list>['manual']

describe('overlay: shopping', () => {
  it('shows a queued new entry at the end, with the bike name', () => {
    const rows = [row({ clientId: 'n1', url: '/api/shopping', body: { clientId: 'n1', text: 'Brake pads', bikeId: 'b1', partId: 'p1' }, meta: { bikeName: 'KTM' } })]
    const out = overlay('/api/shopping', list(), rows)
    expect(out.manual).toHaveLength(2)
    expect(out.manual[1]).toMatchObject({ id: 'pending-n1', text: 'Brake pads', bikeId: 'b1', bikeName: 'KTM', partId: 'p1', doneAt: null, pending: true })
    expect(out.auto).toHaveLength(1)
  })
  it('shows a queued tick as ticked, and a queued untick as open', () => {
    const tick = row({ method: 'PATCH', url: '/api/shopping/m1', body: { done: true } })
    const ticked = overlay('/api/shopping', list(), [tick]).manual as Manual
    expect(ticked[0]!.doneAt).not.toBeNull()
    expect((ticked[0] as Record<string, unknown>).pendingSync).toBe(true)
    const base = list()
    base.manual[0]!.doneAt = '2026-11-08T10:00:00.000Z' as never
    const open = overlay('/api/shopping', base, [row({ method: 'PATCH', url: '/api/shopping/m1', body: { done: false } })]).manual as Manual
    expect(open[0]!.doneAt).toBeNull()
  })
  it('applies a queued text edit and ignores other entries', () => {
    const rows = [row({ method: 'PATCH', url: '/api/shopping/m1', body: { text: 'Chain lube spray' } }), row({ method: 'PATCH', url: '/api/shopping/m9', body: { done: true } })]
    const out = overlay('/api/shopping', list(), rows).manual as Manual
    expect(out[0]).toMatchObject({ text: 'Chain lube spray', doneAt: null })
  })
})
