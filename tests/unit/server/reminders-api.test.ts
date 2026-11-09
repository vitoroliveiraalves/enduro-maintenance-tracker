import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../../server/db/client'
import { notificationsSent, user } from '../../../server/db/schema'
import { createBike } from '../../../server/utils/bikes'
import { createReminder, deleteReminder, listReminders, markReminderDone, patchReminder, rollYear } from '../../../server/utils/reminders'
import { truncateUsers } from '../../support/truncate'

let uid: string, other: string
let bike: Awaited<ReturnType<typeof createBike>>
let otherBike: Awaited<ReturnType<typeof createBike>>

const bikeBody = () => ({ clientId: crypto.randomUUID(), name: 'KTM', make: 'KTM', model: '300', year: 2022, stroke: '2T', hoursTenths: 1420, km: 3800, items: [] })
const rem = (over: Record<string, unknown> = {}, owner = uid, b: typeof bike | null = null) =>
  createReminder(owner, b, { clientId: crypto.randomUUID(), title: 'IUC', dueOn: '2027-03-15', repeatYearly: true, ...over })
const status = async (p: Promise<unknown>) => {
  try {
    await p
    return 200
  } catch (e) {
    return (e as { statusCode?: number }).statusCode
  }
}

beforeEach(async () => {
  await truncateUsers()
  const [u, o] = await db.insert(user).values([{ name: 'A', email: 'a@example.com' }, { name: 'B', email: 'b@example.com' }]).returning()
  uid = u!.id
  other = o!.id
  bike = await createBike(uid, bikeBody())
  otherBike = await createBike(other, bikeBody())
})

describe('rollYear', () => {
  it('adds one year; Feb 29 becomes Feb 28', () => {
    expect(rollYear('2026-11-08')).toBe('2027-11-08')
    expect(rollYear('2028-02-29')).toBe('2029-02-28')
  })
})

describe('createReminder', () => {
  it('stores a bike-less reminder and replays on the same clientId', async () => {
    const clientId = crypto.randomUUID()
    const a = await rem({ clientId })
    const b = await rem({ clientId })
    expect(b.id).toBe(a.id)
    expect(a).toMatchObject({ title: 'IUC', dueOn: '2027-03-15', repeatYearly: true, bikeId: null, doneAt: null })
    expect(await listReminders(uid)).toHaveLength(1)
  })

  it('accepts a far-future date but 400s on impossible dates and junk', async () => {
    expect(await status(rem({ dueOn: '2030-01-01' }))).toBe(200)
    for (const dueOn of ['2026-13-45', '2027-02-29', '2026-11-08junk', 'tomorrow', 42, undefined]) {
      expect(await status(rem({ dueOn })), String(dueOn)).toBe(400)
    }
    expect(await status(rem({ title: '' }))).toBe(400)
    expect(await status(rem({ repeatYearly: 'yes' }))).toBe(400)
  })

  it('lists only the user\'s reminders; bike filter includes bike-less ones', async () => {
    await rem({ title: 'Insurance' }, uid, bike)
    await rem({ title: 'IUC' })
    await rem({ title: 'Other rider' }, other, otherBike)
    expect((await listReminders(uid)).map((r) => r.title).sort()).toEqual(['IUC', 'Insurance'])
    const forBike = await listReminders(uid, bike.id)
    expect(forBike.map((r) => r.title).sort()).toEqual(['IUC', 'Insurance'])
    expect(forBike.find((r) => r.title === 'Insurance')!.bikeName).toBe('KTM')
  })
})

describe('markReminderDone', () => {
  it('repeatYearly rolls dueOn forward and re-arms its notifications', async () => {
    const r = await rem({ dueOn: '2028-02-29' })
    await db.insert(notificationsSent).values([{ userId: uid, key: `reminder:${r.id}:7d` }, { userId: uid, key: `reminder:${r.id}:0d` }])
    const done = await markReminderDone(uid, r, { dueOn: '2028-02-29' })
    expect(done).toMatchObject({ dueOn: '2029-02-28', doneAt: null })
    expect(await db.select().from(notificationsSent)).toHaveLength(0)
  })

  it('a replay carrying the old dueOn does not roll twice', async () => {
    const r = await rem({ dueOn: '2027-03-15' })
    const once = await markReminderDone(uid, r, { dueOn: '2027-03-15' })
    const twice = await markReminderDone(uid, once, { dueOn: '2027-03-15' })
    expect(twice.dueOn).toBe('2028-03-15')
  })

  it('without the dueOn the rider saw it is a 400 and nothing rolls', async () => {
    const r = await rem({ dueOn: '2027-03-15' })
    await expect(markReminderDone(uid, r, {})).rejects.toMatchObject({ statusCode: 400 })
    expect((await listReminders(uid))[0]!.dueOn).toBe('2027-03-15')
  })

  it('one-off reminders get doneAt and leave the open list', async () => {
    const r = await rem({ repeatYearly: false })
    const done = await markReminderDone(uid, r, { dueOn: r.dueOn })
    expect(done.doneAt).not.toBeNull()
    expect(await listReminders(uid)).toHaveLength(0)
  })
})

describe('patch / delete', () => {
  it('patching dueOn re-arms notifications; bikeId can be cleared', async () => {
    const r = await rem({}, uid, bike)
    await db.insert(notificationsSent).values({ userId: uid, key: `reminder:${r.id}:7d` })
    const p = await patchReminder(uid, r, null, { dueOn: '2027-04-01', bikeId: null, title: 'IUC 2027' })
    expect(p).toMatchObject({ dueOn: '2027-04-01', bikeId: null, title: 'IUC 2027' })
    expect(await db.select().from(notificationsSent)).toHaveLength(0)
    expect(await status(patchReminder(uid, r, null, { dueOn: '2026-02-30' }))).toBe(400)
  })

  it('a non-string bikeId or a year-0 dueOn is a 400, not a crash', async () => {
    const r = await rem({}, uid, bike)
    for (const bikeId of [123, true, {}, []]) expect(await status(patchReminder(uid, r, null, { bikeId }))).toBe(400)
    expect(await status(patchReminder(uid, r, null, { dueOn: '0000-01-01' }))).toBe(400)
    expect(await status(rem({ bikeId: 123 }))).toBe(400)
  })

  it('delete removes the row', async () => {
    const r = await rem()
    await deleteReminder(uid, r.id)
    expect(await listReminders(uid)).toHaveLength(0)
  })
})
