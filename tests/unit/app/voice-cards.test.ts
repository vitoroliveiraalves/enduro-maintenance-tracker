import { describe, expect, it } from 'vitest'
import { draftFrom, requestFor, type CardCtx } from '../../../app/lib/voice-cards'
import { sourceLines } from '../../../app/lib/voice-sources'
import { formatMoney } from '../../../app/lib/format'

const B1 = '11111111-1111-4111-8111-111111111111'
const B2 = '22222222-2222-4222-8222-222222222222'
const I1 = '33333333-3333-4333-8333-333333333333'
const P1 = '44444444-4444-4444-8444-444444444444'
const C1 = '55555555-5555-4555-8555-555555555555'
const R1 = '66666666-6666-4666-8666-666666666666'
const ctx: CardCtx = {
  bikes: [
    { id: B1, name: 'KTM', meters: 'hours_km', latestReading: { at: '2026-11-01T00:00:00Z', hoursTenths: 1420, km: 3800 } },
    { id: B2, name: 'CB', meters: 'km', latestReading: { at: '2026-11-01T00:00:00Z', hoursTenths: null, km: 12000 } },
  ],
  parts: [{ id: P1, name: 'Junta escape', unit: 'pcs', qtyHundredths: 200 }],
  categories: [{ id: C1, name: 'Fuel' }],
  reminders: [{ id: R1, title: 'IUC', dueOn: '2026-05-01' }],
  today: '2026-11-09',
}

describe('voice cards', () => {
  it('service: hours typed with a comma, items and parts carried, fixed clientIds', () => {
    const d = draftFrom({ kind: 'service', bikeId: B1, itemIds: [I1], at: '2026-11-08', by: 'diy', partsUsed: [{ partId: P1, qtyHundredths: 100 }] }, ctx)
    d.hours = '143,5'
    const r = requestFor(d, ctx)
    expect(r).toEqual({
      url: '/api/services',
      body: { clientId: d.clientId, bikeId: B1, at: '2026-11-08', itemIds: [I1], hoursTenths: 1435, by: 'diy', partsUsed: [{ clientId: d.partsUsed[0]!.clientId, partId: P1, qtyHundredths: 100 }] },
    })
    expect(requestFor(d, ctx)).toEqual(r) // a retry sends the same ids
  })

  it('a missing bike or item asks for a choice instead of guessing', () => {
    const d = draftFrom({ kind: 'service', candidates: [B1, B2], itemCandidates: [], at: '2026-11-08', by: 'diy' }, ctx)
    expect(d.bikeId).toBe('')
    expect(d.bikeChoices).toEqual([B1, B2])
    expect(requestFor(d, ctx)).toEqual({ error: 'Choose the bike.' })
    d.bikeId = B1
    expect(requestFor(d, ctx)).toEqual({ error: 'Choose what was done.' })
    expect(draftFrom({ kind: 'reading', candidates: [], km: 5 }, ctx).bikeChoices).toEqual([B1, B2])
  })

  it('reading: fills the meter not spoken from the last reading; km-only bike sends no hours', () => {
    const d = draftFrom({ kind: 'reading', bikeId: B1, km: 3900 }, ctx)
    expect(d.hours).toBe('142')
    expect(requestFor(d, ctx)).toMatchObject({ url: '/api/readings', body: { bikeId: B1, hoursTenths: 1420, km: 3900 } })
    const s = draftFrom({ kind: 'reading', bikeId: B2, km: 12500, hoursTenths: 99 }, ctx)
    expect(requestFor(s, ctx)).toMatchObject({ body: { bikeId: B2, km: 12500 } })
    expect((requestFor(s, ctx) as { body: object }).body).not.toHaveProperty('hoursTenths')
  })

  it('use part is a negative count change; expense amount in euros; bad numbers are errors', () => {
    const u = draftFrom({ kind: 'use_part', partId: P1, qtyHundredths: 100 }, ctx)
    expect(requestFor(u, ctx)).toMatchObject({ url: `/api/parts/${P1}/movements`, body: { qtyHundredths: -100 } })
    const e = draftFrom({ kind: 'expense', amountCents: 1250, categoryId: C1, at: '2026-11-09', description: 'Fuel' }, ctx)
    expect(e.amount).toBe('12,50')
    e.amount = '13,5'
    expect(requestFor(e, ctx)).toMatchObject({ url: '/api/expenses', body: { amountCents: 1350, categoryId: C1, at: '2026-11-09', description: 'Fuel' } })
    e.amount = 'abc'
    expect(requestFor(e, ctx)).toEqual({ error: 'Enter the amount.' })
  })

  it('add part, shopping and reminder map onto their routes', () => {
    const a = draftFrom({ kind: 'add_part', name: 'Air filter', unit: 'pcs', qtyHundredths: 200 }, ctx)
    expect(requestFor(a, ctx)).toMatchObject({ url: '/api/parts', body: { name: 'Air filter', unit: 'pcs', qtyHundredths: 200, startClientId: a.startClientId } })
    expect(requestFor(draftFrom({ kind: 'shopping', text: 'Grips' }, ctx), ctx)).toMatchObject({ url: '/api/shopping', body: { text: 'Grips' } })
    expect(requestFor(draftFrom({ kind: 'reminder', title: 'Insurance', dueOn: '2026-12-01', repeatYearly: true }, ctx), ctx))
      .toMatchObject({ url: '/api/reminders', body: { title: 'Insurance', dueOn: '2026-12-01', repeatYearly: true } })
  })

  it('add_vehicle, add_maintenance_item, add_note, complete_reminder and delete_part map onto their routes', () => {
    const v = draftFrom({ kind: 'add_vehicle', make: 'Beta', model: '300 RR', year: 2024, vehicleType: 'motorcycle', stroke: '2T', meters: 'hours_km', hoursTenths: 150, km: 400, plate: '12-AB-34' }, ctx)
    expect(requestFor(v, ctx)).toEqual({
      url: '/api/bikes',
      body: { clientId: v.clientId, name: 'Beta 300 RR', make: 'Beta', model: '300 RR', year: 2024, vehicleType: 'motorcycle', stroke: '2T', meters: 'hours_km', hoursTenths: 150, km: 400, plate: '12-AB-34', useTemplate: true },
    })

    const m = draftFrom({ kind: 'add_maintenance_item', bikeId: B1, name: 'Fork oil', everyHoursTenths: 400, everyMonths: 12 }, ctx)
    expect(requestFor(m, ctx)).toEqual({
      url: '/api/items',
      body: { clientId: m.clientId, bikeId: B1, name: 'Fork oil', everyHoursTenths: 400, everyMonths: 12 },
    })

    const n = draftFrom({ kind: 'add_note', bikeId: B1, itemIds: [I1], title: 'Specs', body: 'Bottom drain', specs: [{ label: 'Torque', value: '20 Nm' }] }, ctx)
    expect(requestFor(n, ctx)).toEqual({
      url: `/api/items/${I1}/notes`,
      body: { clientId: n.clientId, title: 'Specs', body: 'Bottom drain', specs: [{ label: 'Torque', value: '20 Nm' }] },
    })

    const cr = draftFrom({ kind: 'complete_reminder', reminderId: R1 }, ctx)
    expect(requestFor(cr, ctx)).toEqual({
      url: `/api/reminders/${R1}/done`,
      body: { dueOn: '2026-05-01' },
    })

    const dp = draftFrom({ kind: 'delete_part', partId: P1 }, ctx)
    expect(requestFor(dp, ctx)).toEqual({
      url: `/api/parts/${P1}`,
      method: 'DELETE',
      body: {},
    })
  })
})

describe('source lines', () => {
  it('formats tool data with the app formatters', () => {
    expect(sourceLines({ tool: 'search_shelf', data: [{ name: 'Junta escape', unit: 'pcs', qtyHundredths: 200 }] })).toEqual(['Junta escape · 2 in stock'])
    expect(sourceLines({ tool: 'item_history', data: [{ at: '2026-09-13', hoursTenths: 1225, by: 'garage', garageName: 'Moto Braga', totalCents: 4500 }] }))
      .toEqual([`13 Sep · 122.5 h · Moto Braga · ${formatMoney(4500)}`])
    expect(sourceLines({ tool: 'costs', data: { totalCents: 5500, byCategory: [] } })).toEqual([`Total · ${formatMoney(5500)}`])
    expect(sourceLines({ tool: 'nope', data: { error: 'not found' } })).toEqual([])
  })
})
