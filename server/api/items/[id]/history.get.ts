import { defineEventHandler, getRouterParam } from 'h3'
import { requireUser } from '../../../utils/require-user'
import { itemHistory } from '../../../utils/item-history'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  return itemHistory(getRouterParam(event, 'id') ?? '', user.id)
})
