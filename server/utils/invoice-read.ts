import { and, asc, eq, lt, ne } from 'drizzle-orm'
import { createError } from 'h3'
import type { H3Event } from 'h3'
import { db } from '../db/client'
import { documentFiles, documents } from '../db/schema'
import type { Document } from '../db/schema'
import { extractInvoice, readErrorMessage } from './invoice-extract'
import type { ExtractDoc, ExtractOutcome } from './invoice-extract'
import { assertReadAllowed } from './rate-limit'
import { aiEnabled } from './admin'

/** A read still "reading" after this long is given up on (GET flips it to manual). */
export const STUCK_MS = 120_000

export type ReaderCfg = {
  apiKey: string
  model: string
  /** '' = OpenRouter; 'mock' / 'mock-fail' = canned reader for e2e (NUXT_INVOICE_READER). */
  reader: string
  dailyCap: number
  /** All users together, per 24 h (NUXT_INVOICE_GLOBAL_DAILY_CAP). */
  globalDailyCap?: number
}

export const isMock = (cfg: Pick<ReaderCfg, 'reader'>) => cfg.reader === 'mock' || cfg.reader === 'mock-fail'
export const readingAvailable = (cfg: Pick<ReaderCfg, 'apiKey' | 'reader'>) => !!cfg.apiKey || isMock(cfg)

export function readerConfig(event: H3Event): ReaderCfg {
  const c = useRuntimeConfig(event)
  return {
    apiKey: String(c.openrouterApiKey ?? ''),
    model: String(c.openrouterModel || 'google/gemini-3.1-flash-lite'),
    reader: String(c.invoiceReader ?? ''),
    dailyCap: Number(c.invoiceDailyCap) || 30,
    globalDailyCap: Number(c.invoiceGlobalDailyCap) || 300,
  }
}

/** The reader for this rider: an account with AI switched off reads like a server without a key (QR only, manual lines). */
export async function readerConfigFor(event: H3Event, userId: string): Promise<ReaderCfg> {
  const cfg = readerConfig(event)
  return (await aiEnabled(userId)) ? cfg : { ...cfg, apiKey: '', reader: '' }
}

const MOCK_FAIL = Buffer.from('MOCK-FAIL')

/** e2e stand-in for the model: three canned lines, or a failure for a file carrying the MOCK-FAIL marker. */
async function mockExtract(files: ExtractDoc[], cfg: ReaderCfg): Promise<ExtractOutcome> {
  await new Promise((r) => setTimeout(r, 300))
  if (cfg.reader === 'mock-fail' || files.some((f) => f.bytes.includes(MOCK_FAIL))) return { ok: false, error: 'unreadable' }
  return {
    ok: true,
    meta: { model: 'mock' },
    data: {
      lines: [
        { description: 'Pneu Michelin Enduro Medium 140/80-18', kind: 'tyre', qty: 1, unitCents: 12900, totalCents: 12900 },
        { description: 'Mão de obra', kind: 'labour', qty: 1, unitCents: 3000, totalCents: 3000 },
        { description: 'Rolamentos roda traseira', kind: 'part', qty: 1, unitCents: 5640, totalCents: 5640 },
      ],
    },
  }
}

const own = (id: string, userId: string) => and(eq(documents.id, id), eq(documents.userId, userId))

/** Only a read still in flight may end it: a discarded, confirmed or timed-out document is left alone. */
async function endInManual(id: string, userId: string, error: string) {
  await db.update(documents).set({ status: 'manual', error }).where(and(own(id, userId), eq(documents.status, 'reading')))
}

async function runRead(id: string, userId: string, cfg: ReaderCfg, fetchImpl?: typeof fetch) {
  const files = await db
    .select({ mime: documentFiles.mime, bytes: documentFiles.bytes })
    .from(documentFiles)
    .where(and(eq(documentFiles.documentId, id), eq(documentFiles.userId, userId)))
    .orderBy(asc(documentFiles.page))
  const out = isMock(cfg) ? await mockExtract(files, cfg) : await extractInvoice(files, cfg, fetchImpl)
  if (!out.ok) {
    console.warn('[invoice-read] failed', { id, error: out.error, meta: out.meta })
    return endInManual(id, userId, readErrorMessage(out.error))
  }
  const { lines, ...header } = out.data
  if (!lines.length) return endInManual(id, userId, readErrorMessage('no_lines'))
  const [doc] = await db.select().from(documents).where(own(id, userId))
  if (!doc) return
  await db
    .update(documents)
    .set({
      status: 'review',
      error: null,
      extracted: { lines, header, meta: out.meta ?? null },
      supplierName: doc.supplierName ?? header.supplierName ?? null,
      // The QR is ground truth: the model only fills a header the QR didn't give.
      ...(doc.qrRaw
        ? {}
        : {
            supplierNif: doc.supplierNif ?? header.supplierNif ?? null,
            number: doc.number ?? header.number ?? null,
            issuedAt: doc.issuedAt ?? header.issuedAt ?? null,
            totalCents: doc.totalCents ?? header.totalCents ?? null,
          }),
    })
    .where(and(own(id, userId), eq(documents.status, 'reading')))
}

/**
 * Start reading `doc` (ownership already checked). Runs in-process without
 * being awaited by the caller; `done` settles when the read has ended — only
 * tests wait on it. Never leaves a document in `reading` because of an error.
 */
/** Reads running in this process, by document id: a repeat /read (double tap, retry) joins it instead of paying twice. */
const inFlight = new Map<string, Promise<void>>()

export async function requestRead(
  doc: Document,
  cfg: ReaderCfg,
  deps: { fetchImpl?: typeof fetch } = {},
): Promise<{ status: 'reading' | 'manual'; error: string | null; done: Promise<void> }> {
  if (doc.status === 'confirmed') throw createError({ statusCode: 409, statusMessage: 'This invoice is already saved.' })
  const running = inFlight.get(doc.id)
  if (running) return { status: 'reading', error: null, done: running }
  const notConfirmed = and(own(doc.id, doc.userId), ne(documents.status, 'confirmed'))
  if (!readingAvailable(cfg)) {
    const error = readErrorMessage('no_key')
    await db.update(documents).set({ status: 'manual', error }).where(notConfirmed)
    return { status: 'manual', error, done: Promise.resolve() }
  }
  try {
    assertReadAllowed(doc.userId, cfg.dailyCap, Date.now(), cfg.globalDailyCap)
  } catch (err) {
    await db.update(documents).set({ status: 'manual', error: (err as { statusMessage?: string }).statusMessage ?? 'Too many reads.' }).where(notConfirmed)
    throw err
  }
  // No await between the in-flight check above and this set: two parallel requests cannot both start.
  const marked = Promise.resolve(db.update(documents).set({ status: 'reading', error: null, updatedAt: new Date() }).where(notConfirmed))
  const done = (async () => {
    await marked
    await runRead(doc.id, doc.userId, cfg, deps.fetchImpl)
  })()
    .catch(async (err) => {
      console.error('[invoice-read] crashed', { id: doc.id, err })
      await endInManual(doc.id, doc.userId, readErrorMessage('crash')).catch(() => {})
    })
    .finally(() => inFlight.delete(doc.id))
  inFlight.set(doc.id, done)
  await marked.catch(() => {})
  return { status: 'reading', error: null, done }
}

/** A read that has been "reading" for more than STUCK_MS is given up: the rider types the lines. */
export async function flipIfStuck(doc: Document, now = new Date()): Promise<Document> {
  if (doc.status !== 'reading' || now.getTime() - doc.updatedAt.getTime() <= STUCK_MS) return doc
  const [row] = await db
    .update(documents)
    .set({ status: 'manual', error: readErrorMessage('timeout') })
    .where(and(own(doc.id, doc.userId), eq(documents.status, 'reading'), lt(documents.updatedAt, new Date(now.getTime() - STUCK_MS))))
    .returning()
  return row ?? (await db.select().from(documents).where(own(doc.id, doc.userId)))[0] ?? doc
}
