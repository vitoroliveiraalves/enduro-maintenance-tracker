import { createError, type H3Event } from 'h3'
import type { Bike } from '../db/schema'
import { countsHours, countsKm, METERS_LABEL } from '../../shared/utils/meters'
import { SCAN_DAILY_CAP, SCAN_GLOBAL_DAILY_CAP } from './rate-limit'

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'
const TIMEOUT_MS = 30_000

export type ScanResult = {
  hours: number | null
  km: number | null
  confidence: 'high' | 'medium' | 'low' | 'unreadable'
}

export type ScanCfg = {
  apiKey: string
  model: string
  reader: string
  dailyCap: number
  globalDailyCap: number
}

export function scanConfig(event: H3Event): ScanCfg {
  const c = useRuntimeConfig(event)
  return {
    apiKey: String(c.openrouterApiKey ?? ''),
    model: String(c.openrouterModel || 'google/gemini-3.1-flash-lite'),
    reader: String(c.scanReader || c.invoiceReader || ''),
    dailyCap: Number(c.scanDailyCap) || SCAN_DAILY_CAP,
    globalDailyCap: Number(c.scanGlobalDailyCap) || SCAN_GLOBAL_DAILY_CAP,
  }
}

export const scanAvailable = (cfg: Pick<ScanCfg, 'apiKey' | 'reader'>) => !!cfg.apiKey || cfg.reader === 'mock'

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['hours', 'km', 'confidence'],
  properties: {
    hours: {
      type: ['number', 'null'],
      description: 'Total operating hours as a decimal, e.g. 142.5; null if not visible or not tracked.',
    },
    km: {
      type: ['integer', 'null'],
      description: 'Total odometer km as an integer, e.g. 3812; null if not visible or not tracked.',
    },
    confidence: {
      type: 'string',
      enum: ['high', 'medium', 'low', 'unreadable'],
    },
  },
} as const

function buildPrompt(bike: Bike, last: { hoursTenths: number | null; km: number | null } | null): string {
  const trackHours = countsHours(bike.meters)
  const trackKm = countsKm(bike.meters)
  return [
    'You read motorcycle hour meters and digital/analog speedometers from photos.',
    'Extract the current total hours and/or total odometer km from the display.',
    `Bike: ${bike.make} ${bike.model} (${bike.name})`,
    `Tracked meters: ${METERS_LABEL[bike.meters]}`,
    last?.hoursTenths != null ? `Last recorded hours: ${(last.hoursTenths / 10).toFixed(1)} h` : null,
    last?.km != null ? `Last recorded km: ${last.km} km` : null,
    'Rules:',
    trackHours ? '- Total engine hours is usually a number with 1 decimal place (e.g. 142.5). Look for an hourglass ⏳ symbol, "h", "HRS", or a single decimal point on a 7-segment digital LCD.' : '- This bike does NOT track hours: return null for hours.',
    trackKm ? '- Total odometer km is an integer (e.g. 3812). Do NOT confuse trip meters (TRIP A, TRIP 1) with the total odometer (ODO, TOTAL) if both are visible.' : '- This bike does NOT track km: return null for km.',
    '- If numbers are unclear, scratched, cut off, or not present, return null and set confidence to "unreadable" or "low".',
    '- Never guess or extrapolate beyond what is shown.',
  ].filter(Boolean).join('\n')
}

const MOCK_FAIL = Buffer.from('MOCK-FAIL')

export async function scanReading(
  image: { mime: string; data: Buffer },
  bike: Bike,
  last: { hoursTenths: number | null; km: number | null } | null,
  cfg: ScanCfg,
  fetchImpl: typeof fetch = fetch,
): Promise<ScanResult> {
  if (cfg.reader === 'mock' || !cfg.apiKey) {
    if (image.data.includes(MOCK_FAIL) || cfg.reader === 'mock-fail') {
      return { hours: null, km: null, confidence: 'unreadable' }
    }
    const h = countsHours(bike.meters) ? (last?.hoursTenths != null ? (last.hoursTenths + 25) / 10 : 142.5) : null
    const k = countsKm(bike.meters) ? (last?.km != null ? last.km + 45 : 3812) : null
    return { hours: h, km: k, confidence: 'high' }
  }

  const dataUrl = `data:${image.mime};base64,${image.data.toString('base64')}`
  const body = {
    model: cfg.model,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: dataUrl } },
          { type: 'text', text: buildPrompt(bike, last) },
        ],
      },
    ],
    response_format: { type: 'json_schema', json_schema: { name: 'odometer_reading', strict: true, schema: SCHEMA } },
    provider: { require_parameters: true },
    temperature: 0,
  }

  let res: Response
  try {
    res = await fetchImpl(OPENROUTER_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json', 'X-Title': 'Dirt Garage' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch {
    throw createError({ statusCode: 502, statusMessage: "Photo scanning couldn't be processed — try again." })
  }

  if (!res.ok) throw createError({ statusCode: 502, statusMessage: "Photo scanning couldn't be processed — try again." })

  let parsed: unknown
  try {
    const json = await res.json()
    const content = json?.choices?.[0]?.message?.content
    parsed = typeof content === 'string' ? JSON.parse(content) : null
  } catch {
    throw createError({ statusCode: 502, statusMessage: "Photo scanning couldn't be processed — try again." })
  }

  if (!parsed || typeof parsed !== 'object') {
    return { hours: null, km: null, confidence: 'unreadable' }
  }

  const p = parsed as Record<string, unknown>
  const rawH = typeof p.hours === 'number' && Number.isFinite(p.hours) && p.hours >= 0 && p.hours <= 1_000_000 ? Math.round(p.hours * 10) / 10 : null
  const rawK = typeof p.km === 'number' && Number.isFinite(p.km) && p.km >= 0 && p.km <= 10_000_000 ? Math.round(p.km) : null
  const conf = ['high', 'medium', 'low', 'unreadable'].includes(String(p.confidence)) ? (p.confidence as ScanResult['confidence']) : 'low'

  return {
    hours: countsHours(bike.meters) ? rawH : null,
    km: countsKm(bike.meters) ? rawK : null,
    confidence: conf,
  }
}
