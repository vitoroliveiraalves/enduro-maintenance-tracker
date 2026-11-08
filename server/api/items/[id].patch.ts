import { defineEventHandler, getRouterParam, readBody } from 'h3'
import { ownedBike, ownedItem } from '../../utils/owned'
import { patchItem } from '../../utils/bikes'

export default defineEventHandler(async (event) => {
  const item = await ownedItem(event, getRouterParam(event, 'id') ?? '')
  const bike = await ownedBike(event, item.bikeId)
  return patchItem(item, bike.userId, await readBody(event))
})
