import { defineEventHandler, getRouterParam, readBody } from 'h3'
import { ownedBike } from '../../utils/owned'
import { patchBike } from '../../utils/bikes'

export default defineEventHandler(async (event) =>
  patchBike(await ownedBike(event, getRouterParam(event, 'id') ?? ''), await readBody(event)),
)
