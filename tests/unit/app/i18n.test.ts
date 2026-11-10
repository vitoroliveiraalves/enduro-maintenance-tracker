import { afterEach, describe, expect, it } from 'vitest'
import { activeLocale, msgs, phoneLocale, readLocaleChoice, resolveLocale, saveLocaleChoice, setActiveLocale } from '../../../app/lib/i18n'
import { en } from '../../../app/i18n/en'
import { pt } from '../../../app/i18n/pt'
import { categoryLabel, itemLabel, serverText } from '../../../app/lib/server-text'
import { formatDate, formatDayMonth, formatHours, formatHoursLong, formatMoney, formatQty, formatWeekdayDay } from '../../../app/lib/format'
import { dueText } from '../../../app/lib/reminders'
import { stateText } from '../../../app/lib/item-state'
import { DEFAULT_CATEGORIES } from '../../../server/utils/categories-seed'
import { templatesFor } from '../../../server/domain/templates'
import { pickLocale } from '../../../shared/utils/locale'

const store = (init: Record<string, string> = {}) => {
  const m = new Map(Object.entries(init))
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m }
}

afterEach(() => setActiveLocale('en'))

describe('picking the language', () => {
  it('takes the first preferred language the app speaks; any Portuguese phone gets pt-PT', () => {
    expect(pickLocale(['pt-PT', 'en'])).toBe('pt')
    expect(pickLocale(['pt-BR'])).toBe('pt')
    expect(pickLocale(['de-DE', 'pt'])).toBe('pt')
    expect(pickLocale(['en-GB', 'pt-PT'])).toBe('en')
    expect(pickLocale(['fr-FR', 'de'])).toBe('en')
    expect(pickLocale('pt-PT,pt;q=0.9,en;q=0.8')).toBe('pt')
    expect(pickLocale([])).toBe('en')
    expect(pickLocale(undefined)).toBe('en')
  })

  it('follows the phone unless the rider picked one; the pick is saved per device', () => {
    expect(phoneLocale({ languages: ['pt-PT'], language: 'pt-PT' })).toBe('pt')
    expect(phoneLocale({ languages: [], language: 'en-US' })).toBe('en')
    expect(phoneLocale(null)).toBe('en')
    expect(resolveLocale('auto', 'pt')).toBe('pt')
    expect(resolveLocale('en', 'pt')).toBe('en')
    const s = store()
    expect(readLocaleChoice(s)).toBe('auto')
    saveLocaleChoice(s, 'pt')
    expect(readLocaleChoice(s)).toBe('pt')
    expect(readLocaleChoice(store({ 'enduro.locale': 'xx' }))).toBe('auto')
    expect(readLocaleChoice({ getItem: () => { throw new Error('blocked') }, setItem: () => {} })).toBe('auto')
    expect(readLocaleChoice(null)).toBe('auto')
  })

  it('switching swaps the words', () => {
    expect(msgs().settings.title).toBe('Settings')
    setActiveLocale('pt')
    expect(activeLocale.value).toBe('pt')
    expect(msgs().settings.title).toBe('Definições')
  })
})

describe('the Portuguese words', () => {
  /** Every leaf, called with sample arguments when it is a function. */
  function leaves(o: unknown, path = ''): Array<[string, unknown]> {
    if (typeof o === 'function') {
      // Parameters are numbers, names, lists or flags: the first sample set that fits.
      const fn = o as (...a: unknown[]) => unknown
      for (const args of [[2, 'X', 'Y', 'Z'], ['X', 'Y', 'Z', 'W'], [['X', 'Y']], ['meters'], [true, 2]]) {
        try {
          return [[path, fn(...args)]]
        } catch {
          // next sample set
        }
      }
      throw new Error(`no sample arguments fit ${path}`)
    }
    if (Array.isArray(o)) return o.map((v, i) => [`${path}.${i}`, v])
    if (o && typeof o === 'object' && !(o instanceof RegExp)) return Object.entries(o).flatMap(([k, v]) => leaves(v, path ? `${path}.${k}` : k))
    return [[path, o]]
  }

  it('cover every English key and never print undefined', () => {
    const enKeys = leaves(en).map(([k]) => k).filter((k) => !k.startsWith('server') && !k.startsWith('seeded'))
    const ptLeaves = new Map(leaves(pt))
    for (const k of enKeys) expect(ptLeaves.has(k), k).toBe(true)
    for (const [k, v] of ptLeaves) {
      if (typeof v === 'string') expect(v, k).not.toMatch(/undefined|NaN/)
    }
  })

  it('are European, not Brazilian, Portuguese', () => {
    const all = leaves(pt).map(([, v]) => String(v)).join('\n')
    for (const br of [/\bcelular\b/i, /\btela\b/i, /\bsenha\b/i, /\bregistrar\b/i, /\bsalvar\b/i, /\bvocê\b/i, /\bnota fiscal\b/i, /\bestá (salvando|carregando|enviando)\b/i]) {
      expect(all, String(br)).not.toMatch(br)
    }
  })

  it('name every seeded category and template item', () => {
    for (const c of DEFAULT_CATEGORIES) expect(pt.seeded.categories[c.name], c.name).toBeTruthy()
    const names = new Set((['2T', '4T'] as const).flatMap((s) => (['hours_km', 'km', 'hours'] as const).flatMap((m) => templatesFor(s, m).map((i) => i.name))))
    for (const n of names) expect(pt.seeded.items[n], n).toBeTruthy()
  })
})

describe('formats in Portuguese', () => {
  it('dates use Portuguese months and weekdays; hours and quantities a decimal comma; money is unchanged', () => {
    setActiveLocale('pt')
    expect(formatDate('2026-10-06')).toBe('6 out 2026')
    expect(formatDayMonth('2026-09-12T00:00:00.000Z')).toBe('12 set')
    expect(formatWeekdayDay('2026-11-02T10:00:00.000Z')).toBe('seg, 2 nov')
    expect(formatHours(1425)).toBe('142,5 h')
    expect(formatHoursLong(12_825)).toBe(`1${String.fromCharCode(0x202f)}282,5 h`)
    expect(formatQty(150, 'L')).toBe('1,5 L')
    expect(formatMoney(123456)).toBe('1.234,56 €')
  })

  it('reminder and item wording follows the language', () => {
    setActiveLocale('pt')
    expect(dueText(0)).toBe('hoje')
    expect(dueText(5)).toBe('daqui a 5 dias')
    expect(stateText({ status: { state: 'soon', driver: 'hours', remaining: { hoursTenths: 25 } } } as never)).toBe('faltam 2,5h')
  })
})

describe('server text and seeded names', () => {
  it('English leaves server messages and stored names as they are', () => {
    expect(serverText('Daily voice limit reached — you can still use the app as usual.')).toBe('Daily voice limit reached — you can still use the app as usual.')
    expect(categoryLabel('Fuel')).toBe('Fuel')
  })

  it('Portuguese translates known server messages, including the ones with numbers', () => {
    setActiveLocale('pt')
    expect(serverText('Daily invoice reading limit reached — you can still add the lines yourself.')).toBe('Atingiu o limite diário de leitura de faturas — pode juntar as linhas à mão.')
    expect(serverText('Too many voice notes — try again in 7 min.')).toBe('Demasiadas notas de voz — tente de novo daqui a 7 min.')
    expect(serverText('Gearbox oil on KTM 300 — overdue')).toBe('Gearbox oil na KTM 300 — em atraso')
    expect(serverText('keep 2, have 1')).toBe('manter 2, tem 1')
    expect(serverText('Something new from the server')).toBe('Something new from the server')
  })

  it('Portuguese shows default categories and template items in Portuguese, and keeps the rider’s own names', () => {
    setActiveLocale('pt')
    expect(categoryLabel('Fuel')).toBe('Combustível')
    expect(categoryLabel('Gasolina BP')).toBe('Gasolina BP')
    expect(itemLabel('Air filter clean')).toBe('Limpeza do filtro de ar')
  })
})
