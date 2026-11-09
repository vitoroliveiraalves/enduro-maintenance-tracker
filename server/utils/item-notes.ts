import { and, asc, count, eq } from 'drizzle-orm'
import { createError } from 'h3'
import { db } from '../db/client'
import { itemNotePhotos, itemNotes } from '../db/schema'
import type { ItemNote, MaintenanceItem, NoteSpec } from '../db/schema'
import { isObj, str } from './bikes'
import { magicOk, MAX_FILE_BYTES } from './upload-guard'
import { bad, uuid } from './validate'

export const MAX_NOTE_PHOTOS = 6
export const MAX_NOTES_PER_ITEM = 100
const MAX_BODY = 8000
const MAX_SPECS = 40
const PHOTO_MIMES = ['image/jpeg', 'image/png']

export type NoteJson = ItemNote & { photos: Array<{ id: string }> }

function body(v: unknown): string {
  if (typeof v !== 'string' || v.length > MAX_BODY) throw bad('Invalid body')
  return v.replace(/\s+$/, '')
}

function specs(v: unknown): NoteSpec[] {
  if (!Array.isArray(v) || v.length > MAX_SPECS) throw bad('Invalid specs')
  return v.map((s) => {
    if (!isObj(s) || (s.value !== undefined && typeof s.value !== 'string')) throw bad('Invalid specs')
    const value = typeof s.value === 'string' ? s.value.trim() : ''
    if (value.length > 120) throw bad('Invalid specs')
    return { label: str(s.label, 'specs', 80), value }
  })
}

async function withPhotos(note: ItemNote): Promise<NoteJson> {
  const photos = await db
    .select({ id: itemNotePhotos.id })
    .from(itemNotePhotos)
    .where(and(eq(itemNotePhotos.noteId, note.id), eq(itemNotePhotos.userId, note.userId)))
    .orderBy(asc(itemNotePhotos.createdAt), asc(itemNotePhotos.id))
  return { ...note, photos }
}

export async function listNotes(item: MaintenanceItem): Promise<NoteJson[]> {
  const notes = await db
    .select()
    .from(itemNotes)
    .where(and(eq(itemNotes.itemId, item.id), eq(itemNotes.userId, item.userId)))
    .orderBy(asc(itemNotes.createdAt), asc(itemNotes.id))
  return Promise.all(notes.map(withPhotos))
}

/** `item` must already be ownership-checked. Upserts on (userId, clientId). */
export async function createNote(item: MaintenanceItem, raw: unknown): Promise<NoteJson> {
  if (!isObj(raw)) throw bad('Invalid body')
  const values = {
    itemId: item.id,
    userId: item.userId,
    clientId: uuid(raw.clientId),
    title: str(raw.title, 'title', 120),
    body: raw.body === undefined ? '' : body(raw.body),
    specs: raw.specs === undefined ? [] : specs(raw.specs),
  }
  const [{ n } = { n: 0 }] = await db.select({ n: count() }).from(itemNotes).where(and(eq(itemNotes.itemId, item.id), eq(itemNotes.userId, item.userId)))
  if (n >= MAX_NOTES_PER_ITEM) throw bad(`At most ${MAX_NOTES_PER_ITEM} notes per item.`)
  await db.insert(itemNotes).values(values).onConflictDoNothing({ target: [itemNotes.userId, itemNotes.clientId] })
  const [row] = await db.select().from(itemNotes).where(and(eq(itemNotes.userId, item.userId), eq(itemNotes.clientId, values.clientId)))
  return withPhotos(row!)
}

export async function patchNote(note: ItemNote, raw: unknown): Promise<NoteJson> {
  if (!isObj(raw)) throw bad('Invalid body')
  const set: Partial<Pick<ItemNote, 'title' | 'body' | 'specs'>> = {}
  if (raw.title !== undefined) set.title = str(raw.title, 'title', 120)
  if (raw.body !== undefined) set.body = body(raw.body)
  if (raw.specs !== undefined) set.specs = specs(raw.specs)
  if (!Object.keys(set).length) return withPhotos(note)
  const [row] = await db
    .update(itemNotes)
    .set(set)
    .where(and(eq(itemNotes.id, note.id), eq(itemNotes.userId, note.userId)))
    .returning()
  return withPhotos(row ?? note)
}

export async function deleteNote(note: ItemNote) {
  await db.delete(itemNotes).where(and(eq(itemNotes.id, note.id), eq(itemNotes.userId, note.userId)))
  return { ok: true }
}

/** One photo (already downscaled to JPEG by the client). Upserts on (userId, clientId). */
export async function addNotePhoto(note: ItemNote, file: { clientId: unknown; mime: string | undefined; data: Buffer }) {
  const clientId = uuid(file.clientId)
  const [existing] = await db
    .select({ id: itemNotePhotos.id })
    .from(itemNotePhotos)
    .where(and(eq(itemNotePhotos.userId, note.userId), eq(itemNotePhotos.clientId, clientId)))
  if (existing) return existing
  const mime = file.mime ?? ''
  if (!PHOTO_MIMES.includes(mime) || !magicOk(mime, file.data)) throw bad('The file is not a valid JPEG or PNG photo.')
  if (file.data.length > MAX_FILE_BYTES) throw createError({ statusCode: 413, statusMessage: 'Photo too large (10 MB max).' })
  const [{ n } = { n: 0 }] = await db.select({ n: count() }).from(itemNotePhotos).where(and(eq(itemNotePhotos.noteId, note.id), eq(itemNotePhotos.userId, note.userId)))
  if (n >= MAX_NOTE_PHOTOS) throw bad(`At most ${MAX_NOTE_PHOTOS} photos per note.`)
  await db
    .insert(itemNotePhotos)
    .values({ noteId: note.id, userId: note.userId, clientId, mime, bytes: file.data })
    .onConflictDoNothing({ target: [itemNotePhotos.userId, itemNotePhotos.clientId] })
  const [row] = await db
    .select({ id: itemNotePhotos.id })
    .from(itemNotePhotos)
    .where(and(eq(itemNotePhotos.userId, note.userId), eq(itemNotePhotos.clientId, clientId)))
  return row!
}

export async function notePhoto(note: ItemNote, photoId: string) {
  const [row] = await db
    .select({ mime: itemNotePhotos.mime, bytes: itemNotePhotos.bytes })
    .from(itemNotePhotos)
    .where(and(eq(itemNotePhotos.id, photoId), eq(itemNotePhotos.noteId, note.id), eq(itemNotePhotos.userId, note.userId)))
  return row ?? null
}

export async function deleteNotePhoto(note: ItemNote, photoId: string) {
  await db.delete(itemNotePhotos).where(and(eq(itemNotePhotos.id, photoId), eq(itemNotePhotos.noteId, note.id), eq(itemNotePhotos.userId, note.userId)))
  return { ok: true }
}
