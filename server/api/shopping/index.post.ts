import { defineEventHandler, readBody } from 'h3'
import { db } from '../../db/client'
import { requireUser } from '../../utils/require-user'
import { createEntry, entryRow } from '../../utils/shopping'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const body = await readBody(event)
  const entry = await db.transaction((tx) => createEntry(tx, user.id, body))
  return entryRow(user.id, entry.id)
})
