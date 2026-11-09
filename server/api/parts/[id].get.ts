import { defineEventHandler, getRouterParam } from 'h3'
import { ownedPart } from '../../utils/owned'
import { partHistory, partRow } from '../../utils/parts'

export default defineEventHandler(async (event) => {
  const part = await ownedPart(event, getRouterParam(event, 'id') ?? '')
  return { ...(await partRow(part.userId, part.id)), history: await partHistory(part.userId, part.id) }
})
