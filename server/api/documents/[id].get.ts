import { and, asc, eq } from 'drizzle-orm'
import { defineEventHandler, getRouterParam } from 'h3'
import { db } from '../../db/client'
import { documentFiles } from '../../db/schema'
import { ownedDocument } from '../../utils/owned'

export default defineEventHandler(async (event) => {
  const doc = await ownedDocument(event, getRouterParam(event, 'id') ?? '')
  const pages = await db
    .select({ page: documentFiles.page, mime: documentFiles.mime })
    .from(documentFiles)
    .where(and(eq(documentFiles.documentId, doc.id), eq(documentFiles.userId, doc.userId)))
    .orderBy(asc(documentFiles.page))
  return { ...doc, pages }
})
