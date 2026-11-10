import { createError, defineEventHandler, readMultipartFormData } from 'h3'
import { aiEnabled } from '../../utils/admin'
import { latestReading } from '../../utils/bikes'
import { ownedBike } from '../../utils/owned'
import { assertScanAllowed } from '../../utils/rate-limit'
import { scanAvailable, scanConfig, scanReading } from '../../utils/reading-scan'
import { requireUser } from '../../utils/require-user'
import { magicOk } from '../../utils/upload-guard'
import { isUuid } from '../../utils/validate'

const ALLOWED_MIMES = ['image/jpeg', 'image/png']
const MAX_FILE_BYTES = 10 * 1024 * 1024

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const cfg = scanConfig(event)
  if (!scanAvailable(cfg)) throw createError({ statusCode: 503, statusMessage: 'Photo scanning is not set up on this server.' })
  if (!(await aiEnabled(user.id))) throw createError({ statusCode: 403, statusMessage: 'Automatic reading is off for this account.' })

  const parts = await readMultipartFormData(event)
  if (!parts?.length) throw createError({ statusCode: 400, statusMessage: 'Invalid form data' })

  const bikeIdPart = parts.find((p) => p.name === 'bikeId')?.data.toString('utf8').trim() ?? ''
  if (!isUuid(bikeIdPart)) throw createError({ statusCode: 400, statusMessage: 'Invalid bikeId' })

  const bike = await ownedBike(event, bikeIdPart)
  const filePart = parts.find((p) => (p.name === 'file' || p.name === 'image') && p.data.length)
  if (!filePart) throw createError({ statusCode: 400, statusMessage: 'File missing' })

  if (filePart.data.length > MAX_FILE_BYTES) throw createError({ statusCode: 413, statusMessage: 'File too large (10 MB max).' })

  const mime = filePart.type || 'image/jpeg'
  if (!ALLOWED_MIMES.includes(mime)) throw createError({ statusCode: 400, statusMessage: 'Unsupported format — use JPEG or PNG.' })
  if (!magicOk(mime, filePart.data)) throw createError({ statusCode: 400, statusMessage: 'The file is not a valid image.' })

  assertScanAllowed(user.id, cfg.dailyCap, Date.now(), cfg.globalDailyCap)

  const last = await latestReading(bike.id, user.id)
  const lastMeters = last ? { hoursTenths: last.hoursTenths, km: last.km } : null

  return scanReading({ mime, data: filePart.data }, bike, lastMeters, cfg)
})
