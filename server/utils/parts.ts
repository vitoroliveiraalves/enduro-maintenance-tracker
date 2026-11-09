import { and, eq, isNull, lte, sql } from 'drizzle-orm'
import { partMovements, parts, shoppingEntries } from '../db/schema'
import type { MovementKind, Part } from '../db/schema'
import type { Tx } from './expenses'
import { bad, isInt } from './validate'

/** ±10 000 units, in hundredths. */
const MAX_QTY = 1_000_000

/** Integer hundredths within ±10 000 units (negative only with `allowNegative`); 400 otherwise. */
export function qty(v: unknown, field: string, { allowNegative = false }: { allowNegative?: boolean } = {}): number {
  if (!isInt(v, allowNegative ? -MAX_QTY : 0, MAX_QTY)) throw bad(`Invalid ${field}`)
  return v
}

export interface MovementInput {
  userId: string
  clientId: string
  part: Part | null
  partName: string
  unit: string
  kind: MovementKind
  qtyHundredths: number
  at: string
  expenseId?: string
  documentId?: string
  serviceId?: string
  note?: string
}

/**
 * Record a movement and move the part's count by its signed quantity, in SQL
 * (never read-modify-write). Replaying a clientId changes nothing. A 'bought'
 * movement also ticks the part's open manual shopping entries.
 */
export async function applyMovement(tx: Tx, m: MovementInput): Promise<{ applied: boolean }> {
  const inserted = await tx
    .insert(partMovements)
    .values({
      userId: m.userId,
      clientId: m.clientId,
      partId: m.part?.id ?? null,
      partName: m.partName,
      unit: m.unit,
      kind: m.kind,
      qtyHundredths: m.qtyHundredths,
      at: m.at,
      expenseId: m.expenseId ?? null,
      documentId: m.documentId ?? null,
      serviceId: m.serviceId ?? null,
      note: m.note ?? null,
    })
    .onConflictDoNothing({ target: [partMovements.userId, partMovements.clientId] })
    .returning({ id: partMovements.id })
  if (!inserted.length) return { applied: false }
  if (!m.part) return { applied: true }

  await tx
    .update(parts)
    .set({ qtyHundredths: sql`${parts.qtyHundredths} + ${m.qtyHundredths}` })
    .where(and(eq(parts.id, m.part.id), eq(parts.userId, m.userId)))
  if (m.kind === 'bought') {
    await tx
      .update(shoppingEntries)
      .set({ doneAt: sql`now()` })
      .where(
        and(
          eq(shoppingEntries.userId, m.userId),
          eq(shoppingEntries.partId, m.part.id),
          isNull(shoppingEntries.doneAt),
          lte(shoppingEntries.createdAt, sql`now()`),
        ),
      )
  }
  return { applied: true }
}
