import { defineEventHandler, getQuery, setHeader } from 'h3'
import { requireUser } from '../../utils/require-user'
import { costsCsv, parseCostsQuery } from '../../domain/costs-query'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const p = parseCostsQuery(getQuery(event))
  const csv = await costsCsv(user.id, p)
  setHeader(event, 'Content-Type', 'text/csv; charset=utf-8')
  setHeader(event, 'Content-Disposition', `attachment; filename="enduro-costs-${p.period}-${p.date}.csv"`)
  setHeader(event, 'Cache-Control', 'no-store')
  return csv
})
