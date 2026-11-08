import { defineEventHandler, getRouterParam } from 'h3'
import { ownedCategory } from '../../utils/owned'
import { deleteCategory } from '../../utils/categories'

export default defineEventHandler(async (event) => {
  const c = await ownedCategory(event, getRouterParam(event, 'id') ?? '')
  await deleteCategory(c.userId, c)
  return { ok: true }
})
