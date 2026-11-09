import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../../server/db/client'
import { itemNotePhotos, itemNotes, maintenanceItems, user } from '../../../server/db/schema'
import type { MaintenanceItem } from '../../../server/db/schema'
import { createBike } from '../../../server/utils/bikes'
import { addNotePhoto, createNote, deleteNote, deleteNotePhoto, listNotes, MAX_NOTE_PHOTOS, notePhoto, patchNote } from '../../../server/utils/item-notes'
import { truncateUsers } from '../../support/truncate'

let uid: string
let item: MaintenanceItem
const jpeg = (n = 1) => Buffer.from([0xff, 0xd8, 0xff, 0xe0, n, 2, 3, 4])
const note = (over: Record<string, unknown> = {}) => ({ clientId: crypto.randomUUID(), title: 'Torque specs', ...over })

beforeEach(async () => {
  await truncateUsers()
  const [u] = await db.insert(user).values({ name: 'A', email: 'a@example.com' }).returning()
  uid = u!.id
  await createBike(uid, {
    clientId: crypto.randomUUID(), name: 'KTM', make: 'KTM', model: '300', year: 2022, stroke: '2T', hoursTenths: 1440, km: 3812,
    items: [{ name: 'Rear wheel', everyHoursTenths: 500 }],
  })
  item = (await db.select().from(maintenanceItems))[0]!
})

describe('item notes', () => {
  it('creates a note with body and spec lines, listed under its item', async () => {
    const n = await createNote(item, note({
      body: '1. Loosen chain adjusters\n2. Pull axle',
      specs: [{ label: 'Axle nut', value: '90 Nm' }, { label: ' Brake caliper bolts ', value: ' 25 Nm ' }],
    }))
    expect(n).toMatchObject({ title: 'Torque specs', body: '1. Loosen chain adjusters\n2. Pull axle', photos: [] })
    expect(n.specs).toEqual([{ label: 'Axle nut', value: '90 Nm' }, { label: 'Brake caliper bolts', value: '25 Nm' }])
    expect((await listNotes(item)).map((x) => x.title)).toEqual(['Torque specs'])
  })

  it('replaying a clientId creates one note', async () => {
    const body = note()
    const a = await createNote(item, body)
    const b = await createNote(item, body)
    expect(b.id).toBe(a.id)
    expect(await db.select().from(itemNotes)).toHaveLength(1)
  })

  it('bad input is a 400', async () => {
    for (const bad of [
      note({ title: '' }),
      note({ title: 'x'.repeat(121) }),
      note({ clientId: 'nope' }),
      note({ body: 'x'.repeat(8001) }),
      note({ body: 5 }),
      note({ specs: 'Axle 90' }),
      note({ specs: [{ label: '', value: '90 Nm' }] }),
      note({ specs: [{ label: 'Axle', value: 90 }] }),
      note({ specs: Array.from({ length: 41 }, () => ({ label: 'a', value: 'b' })) }),
    ]) await expect(createNote(item, bad), JSON.stringify(bad).slice(0, 60)).rejects.toMatchObject({ statusCode: 400 })
    expect(await db.select().from(itemNotes)).toHaveLength(0)
  })

  it('a spec line may leave the value empty (a note to self)', async () => {
    const n = await createNote(item, note({ specs: [{ label: 'Use Loctite 243', value: '' }] }))
    expect(n.specs).toEqual([{ label: 'Use Loctite 243', value: '' }])
  })

  it('patch edits only what is sent; delete removes the note and its photos', async () => {
    const n = await createNote(item, note({ body: 'old' }))
    const p = await patchNote(n, { body: 'new', specs: [{ label: 'Spokes', value: '5 Nm' }] })
    expect(p).toMatchObject({ title: 'Torque specs', body: 'new', specs: [{ label: 'Spokes', value: '5 Nm' }] })
    await expect(patchNote(n, { title: '' })).rejects.toMatchObject({ statusCode: 400 })
    await addNotePhoto(n, { clientId: crypto.randomUUID(), mime: 'image/jpeg', data: jpeg() })
    await deleteNote(n)
    expect(await db.select().from(itemNotes)).toHaveLength(0)
    expect(await db.select().from(itemNotePhotos)).toHaveLength(0)
  })

  it('photos: jpeg/png only, real bytes, idempotent, capped per note, served back, deletable', async () => {
    const n = await createNote(item, note())
    const clientId = crypto.randomUUID()
    const a = await addNotePhoto(n, { clientId, mime: 'image/jpeg', data: jpeg() })
    const again = await addNotePhoto(n, { clientId, mime: 'image/jpeg', data: jpeg() })
    expect(again.id).toBe(a.id)
    await expect(addNotePhoto(n, { clientId: crypto.randomUUID(), mime: 'image/jpeg', data: Buffer.from('<html>') })).rejects.toMatchObject({ statusCode: 400 })
    await expect(addNotePhoto(n, { clientId: crypto.randomUUID(), mime: 'application/pdf', data: Buffer.from('%PDF-1.4') })).rejects.toMatchObject({ statusCode: 400 })
    for (let i = 1; i < MAX_NOTE_PHOTOS; i++) await addNotePhoto(n, { clientId: crypto.randomUUID(), mime: 'image/jpeg', data: jpeg(i) })
    await expect(addNotePhoto(n, { clientId: crypto.randomUUID(), mime: 'image/jpeg', data: jpeg() })).rejects.toMatchObject({ statusCode: 400 })
    const listed = (await listNotes(item))[0]!
    expect(listed.photos).toHaveLength(MAX_NOTE_PHOTOS)
    expect(listed.photos[0]).toEqual({ id: a.id })
    expect(await notePhoto(n, a.id)).toMatchObject({ mime: 'image/jpeg' })
    await deleteNotePhoto(n, a.id)
    expect(await notePhoto(n, a.id)).toBeNull()
  })
})
