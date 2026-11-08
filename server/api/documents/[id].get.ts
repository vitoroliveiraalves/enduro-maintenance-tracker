import { and, asc, eq } from 'drizzle-orm'
import { defineEventHandler, getRouterParam } from 'h3'
import { db } from '../../db/client'
import { categories, documentFiles, expenses } from '../../db/schema'
import { ownedDocument } from '../../utils/owned'
import { flipIfStuck, readerConfig, readingAvailable } from '../../utils/invoice-read'

export default defineEventHandler(async (event) => {
  const doc = await flipIfStuck(await ownedDocument(event, getRouterParam(event, 'id') ?? ''))
  const pages = await db
    .select({ page: documentFiles.page, mime: documentFiles.mime })
    .from(documentFiles)
    .where(and(eq(documentFiles.documentId, doc.id), eq(documentFiles.userId, doc.userId)))
    .orderBy(asc(documentFiles.page))
  // A saved invoice shows the expenses it became.
  const saved =
    doc.status === 'confirmed'
      ? await db
          .select({ line: expenses.documentLine, description: expenses.description, amountCents: expenses.amountCents, bikeId: expenses.bikeId, categoryName: categories.name })
          .from(expenses)
          .innerJoin(categories, eq(expenses.categoryId, categories.id))
          .where(and(eq(expenses.documentId, doc.id), eq(expenses.userId, doc.userId)))
          .orderBy(asc(expenses.documentLine))
      : []
  return { ...doc, pages, saved, canRead: readingAvailable(readerConfig(event)) }
})
