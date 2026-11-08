import { defineEventHandler, getRouterParam } from 'h3'
import { ownedBike } from '../../utils/owned'

export default defineEventHandler((event) => ownedBike(event, getRouterParam(event, 'id') ?? ''))
