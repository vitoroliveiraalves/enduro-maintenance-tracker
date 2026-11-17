import { createError, defineEventHandler, getQuery, getRouterParam, setHeader } from 'h3'
import { manualFile } from '../../../../../utils/manuals'
import { ownedBike } from '../../../../../utils/owned'

export default defineEventHandler(async (event) => {
  const bike = await ownedBike(event, getRouterParam(event, 'id') ?? '')
  const manualId = getRouterParam(event, 'manualId') ?? ''
  const file = await manualFile(bike, manualId)
  if (!file) throw createError({ statusCode: 404, statusMessage: 'Not found' })

  const download = getQuery(event).download === '1'
  const disp = download ? 'attachment' : 'inline'
  setHeader(event, 'Content-Type', 'application/pdf')
  setHeader(event, 'X-Content-Type-Options', 'nosniff')
  setHeader(event, 'Content-Disposition', `${disp}; filename="${file.fileName}"`)
  setHeader(event, 'Cache-Control', 'private, no-store')
  // A PDF can carry scripts and links: render it with no access to the app's origin.
  setHeader(event, 'Content-Security-Policy', 'sandbox')
  return file.bytes
})
