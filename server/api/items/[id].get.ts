import { defineEventHandler, getRouterParam } from 'h3'
import { ownedBike } from '../../utils/owned'
import { itemRows } from '../../utils/bikes'

export default defineEventHandler(async (event) => {
  const bike = await ownedBike(event, getRouterParam(event, 'id') ?? '')
  return itemRows(bike.id, bike.userId)
})
