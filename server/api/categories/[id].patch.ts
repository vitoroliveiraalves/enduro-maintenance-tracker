import { defineEventHandler, getRouterParam, readBody } from 'h3'
import { ownedCategory } from '../../utils/owned'
import { renameCategory } from '../../utils/categories'

export default defineEventHandler(async (event) => {
  const c = await ownedCategory(event, getRouterParam(event, 'id') ?? '')
  return renameCategory(c.userId, c, await readBody(event))
})
