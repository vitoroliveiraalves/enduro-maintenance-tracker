/** The app's languages. Portuguese is European Portuguese (pt-PT), for every `pt-*` phone. */
export const LOCALES = ['en', 'pt'] as const
export type Locale = (typeof LOCALES)[number]
export const DEFAULT_LOCALE: Locale = 'en'
/** BCP 47 tag for `<html lang>`, Intl and the Accept-Language header. */
export const LOCALE_TAG: Record<Locale, string> = { en: 'en', pt: 'pt-PT' }

export const isLocale = (v: unknown): v is Locale => LOCALES.includes(v as Locale)

/** The first preferred language the app speaks ("pt-BR" -> pt, "en-GB" -> en), else English. */
export function pickLocale(preferred: readonly string[] | string | null | undefined): Locale {
  const list = typeof preferred === 'string' ? preferred.split(',') : (preferred ?? [])
  for (const raw of list) {
    const base = raw.trim().split(';')[0]!.toLowerCase().split(/[-_]/)[0]
    if (isLocale(base)) return base
  }
  return DEFAULT_LOCALE
}
