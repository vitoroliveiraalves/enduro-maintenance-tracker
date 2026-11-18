import { defineEventHandler, getQuery, getRouterParam, setHeader } from 'h3'
import { buildVehicleDossierHtml } from '../../../utils/dossier'
import { ownedBike } from '../../../utils/owned'

export default defineEventHandler(async (event) => {
  const bike = await ownedBike(event, getRouterParam(event, 'id') ?? '')
  const { fileName, html } = await buildVehicleDossierHtml(bike)
  const download = getQuery(event).download === '1'
  setHeader(event, 'Content-Type', 'text/html; charset=utf-8')
  setHeader(event, 'X-Content-Type-Options', 'nosniff')
  setHeader(event, 'Content-Disposition', `${download ? 'attachment' : 'inline'}; filename="${fileName}"`)
  setHeader(event, 'Cache-Control', 'private, no-store')
  setHeader(event, 'Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'")
  return html
})
