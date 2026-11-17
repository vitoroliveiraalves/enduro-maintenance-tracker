import { defineEventHandler, getRouterParam } from 'h3'
import { listManuals } from '../../../utils/manuals'
import { ownedBike } from '../../../utils/owned'

export default defineEventHandler(async (event) => {
  const bike = await ownedBike(event, getRouterParam(event, 'id') ?? '')
  return listManuals(bike)
})
