import { defineEventHandler, getRouterParam, readBody } from 'h3'
import { ownedBike } from '../../../utils/owned'
import { undoLatestReading } from '../../../utils/readings'

/** Undo the latest meter reading (a typo). Body: { readingId } — the one the rider saw. */
export default defineEventHandler(async (event) => undoLatestReading(await ownedBike(event, getRouterParam(event, 'id') ?? ''), await readBody(event)))
