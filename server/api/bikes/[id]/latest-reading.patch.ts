import { defineEventHandler, getRouterParam, readBody } from 'h3'
import { ownedBike } from '../../../utils/owned'
import { correctLatestReading } from '../../../utils/readings'

/** Correct the bike's total (hours and/or km of its latest reading), up or down. Body: { hoursTenths?, km? } for the counted meters. */
export default defineEventHandler(async (event) => correctLatestReading(await ownedBike(event, getRouterParam(event, 'id') ?? ''), await readBody(event)))
