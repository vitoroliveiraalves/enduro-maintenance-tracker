import { and, count, desc, eq } from 'drizzle-orm'
import { createError } from 'h3'
import { db } from '../db/client'
import { bikeManuals } from '../db/schema'
import type { Bike } from '../db/schema'
import { isObj, str } from './bikes'
import { magicOk, MAX_MANUAL_BYTES } from './upload-guard'
import { bad, isUuid, uuid } from './validate'

export const MAX_MANUALS_PER_BIKE = 20
export type ManualKind = 'shop' | 'user'

export type ManualJson = {
  id: string
  bikeId: string
  kind: ManualKind
  title: string
  fileName: string
  sizeBytes: number
  createdAt: string
  updatedAt: string
}

const manualColumns = {
  id: bikeManuals.id,
  bikeId: bikeManuals.bikeId,
  kind: bikeManuals.kind,
  title: bikeManuals.title,
  fileName: bikeManuals.fileName,
  sizeBytes: bikeManuals.sizeBytes,
  createdAt: bikeManuals.createdAt,
  updatedAt: bikeManuals.updatedAt,
}

type ManualRow = {
  id: string
  bikeId: string
  kind: ManualKind
  title: string
  fileName: string
  sizeBytes: number
  createdAt: Date
  updatedAt: Date
}

function toJson(row: ManualRow): ManualJson {
  return {
    id: row.id,
    bikeId: row.bikeId,
    kind: row.kind,
    title: row.title,
    fileName: row.fileName,
    sizeBytes: row.sizeBytes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export function parseKind(v: unknown): ManualKind {
  if (v !== 'shop' && v !== 'user') throw bad('Invalid manual kind')
  return v
}

function cleanFileName(raw: string | undefined): string {
  const base = (raw ?? 'manual.pdf').split(/[/\\]/).pop()?.trim() || 'manual.pdf'
  const safe = base.replace(/[\r\n"]/g, '_').slice(0, 200)
  return safe.toLowerCase().endsWith('.pdf') ? safe : `${safe}.pdf`
}

function deriveTitle(rawTitle: string | undefined, fileName: string): string {
  const trimmed = rawTitle?.trim()
  if (trimmed) {
    if (trimmed.length > 120) throw bad('Invalid title')
    return trimmed
  }
  const stripped = fileName.replace(/\.pdf$/i, '').trim()
  return (stripped || 'Manual').slice(0, 120)
}

export async function listManuals(bike: Bike): Promise<ManualJson[]> {
  const rows = await db
    .select(manualColumns)
    .from(bikeManuals)
    .where(and(eq(bikeManuals.bikeId, bike.id), eq(bikeManuals.userId, bike.userId)))
    .orderBy(desc(bikeManuals.createdAt))
  return rows.map(toJson)
}

export async function addManual(
  bike: Bike,
  input: {
    clientId: unknown
    kind: unknown
    title?: string
    fileName?: string
    mime?: string
    data: Buffer
  },
): Promise<ManualJson> {
  const clientId = uuid(input.clientId)
  const kind = parseKind(input.kind)
  const [existing] = await db
    .select(manualColumns)
    .from(bikeManuals)
    .where(and(eq(bikeManuals.userId, bike.userId), eq(bikeManuals.clientId, clientId)))
  if (existing) return toJson(existing)

  if (input.mime !== 'application/pdf') throw bad('Unsupported format — use PDF.')
  if (input.data.length > MAX_MANUAL_BYTES) {
    throw createError({ statusCode: 413, statusMessage: 'File too large (50 MB max).' })
  }
  if (!magicOk('application/pdf', input.data)) throw bad('The file is not a valid PDF.')

  const [{ n } = { n: 0 }] = await db
    .select({ n: count() })
    .from(bikeManuals)
    .where(and(eq(bikeManuals.bikeId, bike.id), eq(bikeManuals.userId, bike.userId)))
  if (n >= MAX_MANUALS_PER_BIKE) throw bad(`At most ${MAX_MANUALS_PER_BIKE} manuals per vehicle.`)

  const fileName = cleanFileName(input.fileName)
  const title = deriveTitle(input.title, fileName)

  await db
    .insert(bikeManuals)
    .values({
      bikeId: bike.id,
      userId: bike.userId,
      clientId,
      kind,
      title,
      fileName,
      sizeBytes: input.data.length,
      bytes: input.data,
    })
    .onConflictDoNothing({ target: [bikeManuals.userId, bikeManuals.clientId] })

  const [row] = await db
    .select(manualColumns)
    .from(bikeManuals)
    .where(and(eq(bikeManuals.userId, bike.userId), eq(bikeManuals.clientId, clientId)))
  return toJson(row!)
}

export async function patchManual(bike: Bike, manualId: string, raw: unknown): Promise<ManualJson | null> {
  if (!isUuid(manualId)) return null
  if (!isObj(raw)) throw bad('Invalid body')
  const set: Partial<{ title: string; kind: ManualKind }> = {}
  if (raw.title !== undefined) set.title = str(raw.title, 'title', 120)
  if (raw.kind !== undefined) set.kind = parseKind(raw.kind)

  if (!Object.keys(set).length) {
    const [existing] = await db
      .select(manualColumns)
      .from(bikeManuals)
      .where(and(eq(bikeManuals.id, manualId), eq(bikeManuals.bikeId, bike.id), eq(bikeManuals.userId, bike.userId)))
    return existing ? toJson(existing) : null
  }

  const [row] = await db
    .update(bikeManuals)
    .set(set)
    .where(and(eq(bikeManuals.id, manualId), eq(bikeManuals.bikeId, bike.id), eq(bikeManuals.userId, bike.userId)))
    .returning(manualColumns)
  return row ? toJson(row) : null
}

export async function deleteManual(bike: Bike, manualId: string): Promise<boolean> {
  if (!isUuid(manualId)) return false
  const [deleted] = await db
    .delete(bikeManuals)
    .where(and(eq(bikeManuals.id, manualId), eq(bikeManuals.bikeId, bike.id), eq(bikeManuals.userId, bike.userId)))
    .returning({ id: bikeManuals.id })
  return Boolean(deleted)
}

export async function manualFile(bike: Bike, manualId: string): Promise<{ fileName: string; bytes: Buffer } | null> {
  if (!isUuid(manualId)) return null
  const [row] = await db
    .select({ fileName: bikeManuals.fileName, bytes: bikeManuals.bytes })
    .from(bikeManuals)
    .where(and(eq(bikeManuals.id, manualId), eq(bikeManuals.bikeId, bike.id), eq(bikeManuals.userId, bike.userId)))
  return row ?? null
}
