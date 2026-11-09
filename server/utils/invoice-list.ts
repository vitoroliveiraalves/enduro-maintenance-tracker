import { and, eq, inArray } from 'drizzle-orm'
import { db } from '../db/client'
import { bikes, documents, expenses } from '../db/schema'

export type InvoiceRow = {
  id: string
  status: 'reading' | 'review' | 'manual' | 'confirmed'
  supplierName: string | null
  issuedAt: string | null
  createdAt: string
  totalCents: number | null
  bikeId: string | null
  bikeName: string | null
  lines: number
}

/** The rider's invoices: not saved yet first, then newest (invoice date, else upload date). */
export async function listDocuments(userId: string): Promise<InvoiceRow[]> {
  const docs = await db
    .select({ id: documents.id, status: documents.status, supplierName: documents.supplierName, issuedAt: documents.issuedAt, createdAt: documents.createdAt, totalCents: documents.totalCents })
    .from(documents)
    .where(eq(documents.userId, userId))
  const ids = docs.map((d) => d.id)
  const exp = ids.length
    ? await db
        .select({ documentId: expenses.documentId, amountCents: expenses.amountCents, bikeId: expenses.bikeId, bikeName: bikes.name })
        .from(expenses)
        .leftJoin(bikes, eq(expenses.bikeId, bikes.id))
        .where(and(eq(expenses.userId, userId), inArray(expenses.documentId, ids)))
    : []
  const rows = docs.map((d): InvoiceRow => {
    const mine = exp.filter((e) => e.documentId === d.id)
    const saved = d.status === 'confirmed'
    return {
      ...d,
      createdAt: d.createdAt.toISOString(),
      totalCents: saved ? mine.reduce((s, e) => s + e.amountCents, 0) : d.totalCents,
      bikeId: mine[0]?.bikeId ?? null,
      bikeName: mine[0]?.bikeName ?? null,
      lines: mine.length,
    }
  })
  const key = (r: InvoiceRow) => r.issuedAt ?? r.createdAt.slice(0, 10)
  return rows.sort((a, b) =>
    Number(a.status === 'confirmed') - Number(b.status === 'confirmed') || key(b).localeCompare(key(a)) || b.createdAt.localeCompare(a.createdAt),
  )
}
