import { defineEventHandler, getRouterParam } from 'h3'
import { ownedBike } from '../../utils/owned'
import { listReadings } from '../../utils/readings'

export default defineEventHandler(async (event) => listReadings(await ownedBike(event, getRouterParam(event, 'bikeId') ?? '')))
