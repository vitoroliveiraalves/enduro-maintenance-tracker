import { describe, expect, it, vi } from 'vitest'
import { buildRequest, extractInvoice, parseExtraction, readErrorMessage } from '../../../server/utils/invoice-extract'

const pdf = { mime: 'application/pdf', bytes: Buffer.from('%PDF-1.4 test') }
const photo = (n: number) => ({ mime: 'image/jpeg', bytes: Buffer.from(`jpeg-${n}`) })
const cfg = { apiKey: 'sk-or-test', model: 'google/gemini-3.1-flash-lite' }

const modelJson = {
  readable: true,
  supplierName: 'Moto Garage Braga, Lda',
  supplierNif: '501 964 843',
  number: 'FT 2026A/0042',
  issuedAt: '2026-11-01',
  pricesIncludeVat: true,
  total: 215.4,
  lines: [
    { description: 'Pneu Michelin Enduro Medium 140/80-18', kind: 'tyre', qty: 1, unitPrice: 129, lineTotal: 129, vatRate: 23 },
    { description: 'Mão de obra', kind: 'labour', qty: 1, unitPrice: 30, lineTotal: 30, vatRate: 23 },
    { description: 'Rolamentos roda traseira', kind: 'part', qty: 2, unitPrice: 28.2, lineTotal: 56.4, vatRate: 23 },
  ],
}
const okResponse = (content: unknown) =>
  new Response(
    JSON.stringify({
      choices: [{ message: { content: typeof content === 'string' ? content : JSON.stringify(content) } }],
      usage: { prompt_tokens: 1200, completion_tokens: 300, cost: 0.0021 },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )
const run = (impl: () => Promise<Response>, opts?: { timeoutMs?: number }) =>
  extractInvoice([photo(1)], cfg, vi.fn(impl) as unknown as typeof fetch, opts)

describe('buildRequest', () => {
  it('sends a PDF as a file part and photos as image_url parts, prompt last', () => {
    const parts = buildRequest([pdf], cfg.model).messages[0]!.content as Array<{ type: string; file?: { file_data: string } }>
    expect(parts[0]).toEqual({ type: 'file', file: { filename: 'invoice-1.pdf', file_data: `data:application/pdf;base64,${pdf.bytes.toString('base64')}` } })
    expect(parts.at(-1)!.type).toBe('text')
    const photos = buildRequest([photo(1), photo(2)], cfg.model).messages[0]!.content as Array<{ type: string }>
    expect(photos.filter((p) => p.type === 'image_url')).toHaveLength(2)
  })

  it('asks for strict JSON-schema output with usage, from schema-honouring endpoints only', () => {
    const req = buildRequest([pdf], cfg.model)
    expect(req.model).toBe('google/gemini-3.1-flash-lite')
    expect(req.response_format).toMatchObject({ type: 'json_schema', json_schema: { name: 'invoice', strict: true } })
    expect(req.provider).toEqual({ require_parameters: true })
    expect(req.usage).toEqual({ include: true })
    expect(req.temperature).toBe(0)
  })
})

describe('parseExtraction', () => {
  it('converts euros to cents and normalises the header', () => {
    const x = parseExtraction(modelJson)
    expect(x).toMatchObject({ supplierName: 'Moto Garage Braga, Lda', supplierNif: '501964843', number: 'FT 2026A/0042', issuedAt: '2026-11-01', totalCents: 21540 })
    expect(x.lines).toEqual([
      { description: 'Pneu Michelin Enduro Medium 140/80-18', kind: 'tyre', qty: 1, unitCents: 12900, totalCents: 12900 },
      { description: 'Mão de obra', kind: 'labour', qty: 1, unitCents: 3000, totalCents: 3000 },
      { description: 'Rolamentos roda traseira', kind: 'part', qty: 2, unitCents: 2820, totalCents: 5640 },
    ])
  })

  it('adds VAT when the printed prices exclude it', () => {
    const x = parseExtraction({ ...modelJson, pricesIncludeVat: false, lines: [{ ...modelJson.lines[1]!, unitPrice: 100, lineTotal: 100, vatRate: 23 }] })
    expect(x.lines[0]).toMatchObject({ unitCents: 12300, totalCents: 12300 })
  })

  it('drops header values the model got wrong instead of failing the read', () => {
    const x = parseExtraction({ ...modelJson, issuedAt: '2026-02-30', supplierNif: '1234', total: 99_999_999, number: 'N'.repeat(200) })
    expect(x.issuedAt).toBeUndefined()
    expect(x.supplierNif).toBeUndefined()
    expect(x.totalCents).toBeUndefined()
    expect(x.number).toHaveLength(60)
    expect(parseExtraction({ ...modelJson, issuedAt: '31/12/2026', supplierName: '  ' })).not.toHaveProperty('supplierName')
  })

  it('one bad row never discards the read: a row without description is dropped, others kept', () => {
    const x = parseExtraction({ ...modelJson, lines: [{ ...modelJson.lines[0]!, description: '' }, { kind: 'part' }, null, modelJson.lines[1]] })
    expect(x.lines).toHaveLength(1)
    expect(x.lines[0]!.description).toBe('Mão de obra')
  })

  it('keeps an unreadable price as null (never invents one) and derives the total from qty × unit', () => {
    const [noPrice, derived] = parseExtraction({
      ...modelJson,
      lines: [
        { ...modelJson.lines[0]!, unitPrice: null, lineTotal: null },
        { ...modelJson.lines[2]!, qty: 2, unitPrice: 28.2, lineTotal: null },
      ],
    }).lines
    expect(noPrice).toMatchObject({ unitCents: null, totalCents: null })
    expect(derived).toMatchObject({ totalCents: 5640 })
  })

  it('unknown kinds become "other"; absurd quantities are dropped', () => {
    const x = parseExtraction({ ...modelJson, lines: [{ ...modelJson.lines[0]!, kind: 'pizza' }] })
    expect(x.lines[0]!.kind).toBe('other')
    const y = parseExtraction({ ...modelJson, lines: [{ ...modelJson.lines[0]!, qty: 1e12 }] })
    expect(y.lines[0]).not.toHaveProperty('qty')
  })

  it('throws when there is no lines array', () => {
    expect(() => parseExtraction({ ...modelJson, lines: 'nope' })).toThrow()
    expect(() => parseExtraction('prose')).toThrow()
  })
})

describe('extractInvoice', () => {
  it('no key → no network call at all', async () => {
    const fetchImpl = vi.fn()
    expect(await extractInvoice([pdf], { apiKey: '', model: cfg.model }, fetchImpl)).toEqual({ ok: false, error: 'no_key' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('posts to OpenRouter with the bearer key; returns lines in cents plus usage/cost', async () => {
    const fetchImpl = vi.fn(async () => okResponse(modelJson))
    const out = await extractInvoice([pdf], cfg, fetchImpl as unknown as typeof fetch)
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-or-test')
    expect(out).toMatchObject({ ok: true, meta: { model: cfg.model, usage: { cost: 0.0021 } } })
    if (!out.ok) throw new Error('expected ok')
    expect(out.data.lines.map((l) => l.totalCents)).toEqual([12900, 3000, 5640])
  })

  // Review Focus 4: every failure is a calm { ok: false }, never a throw, never invented lines.
  it.each([
    ['prose instead of JSON', async () => okResponse('Sure! Here is the invoice: a tyre and some labour.'), 'invalid_json'],
    ['HTTP 500', async () => new Response('boom', { status: 500 }), 'http_500'],
    ['a body that is not JSON', async () => new Response('<html>', { status: 200 }), 'invalid_response'],
    ['a refusal', async () => new Response(JSON.stringify({ choices: [{ message: { content: null, refusal: 'no' } }] }), { status: 200 }), 'refused'],
    ['an unreadable photo', async () => okResponse({ ...modelJson, readable: false }), 'unreadable'],
    ['a network failure', async () => Promise.reject(Object.assign(new Error('down'), { name: 'TypeError' })), 'network'],
  ])('%s → { ok: false, error: %s }', async (_label, impl, error) => {
    expect(await run(impl)).toMatchObject({ ok: false, error })
  })

  it('a model that never answers times out → { ok: false, error: timeout }', async () => {
    const hang = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_res, rej) => init.signal!.addEventListener('abort', () => rej(init.signal!.reason))),
    )
    const out = await extractInvoice([photo(1)], cfg, hang as unknown as typeof fetch, { timeoutMs: 20 })
    expect(out).toMatchObject({ ok: false, error: 'timeout' })
  })
})

describe('readErrorMessage', () => {
  it('gives a short English reason for each failure', () => {
    expect(readErrorMessage('no_key')).toBe('Automatic reading is not set up on this server.')
    expect(readErrorMessage('unreadable')).toMatch(/blurred or cut off/)
    expect(readErrorMessage('timeout')).toMatch(/took too long/)
    expect(readErrorMessage('http_500')).toMatch(/reading service/)
  })
})
