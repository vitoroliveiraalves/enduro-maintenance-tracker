import { expect } from '@playwright/test'
import type { APIRequestContext } from '@playwright/test'

const day = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString().slice(0, 10)
export const bikeBody = (name: string, items: unknown[]) => ({
  clientId: crypto.randomUUID(), name, make: 'KTM', model: '300 EXC', year: 2023, stroke: '2T', hoursTenths: 1425, km: 3812, items,
})

/** A bike shaped like mockup A. Returns its id. */
export async function seedMockupBike(request: APIRequestContext, name: string): Promise<string> {
  const res = await request.post('/api/bikes', {
    data: bikeBody(name, [
      { name: 'Engine/gear oil', everyHoursTenths: 200, lastDone: { at: day(57), hoursTenths: 1220, km: 3000 } },
      { name: 'Air filter clean', everyHoursTenths: 50, lastDone: { at: day(20), hoursTenths: 1385, km: 3500 } },
      { name: 'Chain & sprockets', everyKm: 1500, lastDone: { at: day(60), hoursTenths: 1100, km: 2532 } },
      { name: 'Wheel bearings', everyHoursTenths: 500, everyMonths: 12 },
      { name: 'Piston & rings', everyHoursTenths: 800, lastDone: { at: day(90), hoursTenths: 1075, km: 2800 } },
    ]),
  })
  expect(res.ok()).toBeTruthy()
  const bike = (await res.json()) as { id: string }
  const detail = (await (await request.get(`/api/bikes/${bike.id}`)).json()) as { items: Array<{ id: string; name: string }> }
  const bearings = detail.items.find((i) => i.name === 'Wheel bearings')!
  const svc = await request.post('/api/services', {
    data: { clientId: crypto.randomUUID(), bikeId: bike.id, at: day(33), hoursTenths: 1305, km: 3200, by: 'garage', garageName: 'Moto Garage Braga', itemIds: [bearings.id] },
  })
  expect(svc.ok()).toBeTruthy()
  return bike.id
}
