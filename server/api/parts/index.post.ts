import { defineEventHandler, readBody } from 'h3'
import { db } from '../../db/client'
import { requireUser } from '../../utils/require-user'
import { createPart, partRow } from '../../utils/parts'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const body = await readBody(event)
  const part = await db.transaction((tx) => createPart(tx, user.id, body))
  return partRow(user.id, part.id)
})
