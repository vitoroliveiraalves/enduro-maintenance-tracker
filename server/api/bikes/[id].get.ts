import { defineEventHandler, getRouterParam } from 'h3'
import { ownedBike } from '../../utils/owned'
import { bikeDetail } from '../../utils/bikes'

export default defineEventHandler(async (event) => bikeDetail(await ownedBike(event, getRouterParam(event, 'id') ?? '')))
