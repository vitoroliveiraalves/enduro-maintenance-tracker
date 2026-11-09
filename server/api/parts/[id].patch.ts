import { defineEventHandler, getRouterParam, readBody } from 'h3'
import { db } from '../../db/client'
import { ownedPart } from '../../utils/owned'
import { partRow, patchPart } from '../../utils/parts'

export default defineEventHandler(async (event) => {
  const part = await ownedPart(event, getRouterParam(event, 'id') ?? '')
  const body = await readBody(event)
  await db.transaction((tx) => patchPart(tx, part.userId, part, body))
  return partRow(part.userId, part.id)
})
