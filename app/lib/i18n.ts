import { ref } from 'vue'
import { en, type Messages } from '~/i18n/en'
import { pt } from '~/i18n/pt'
import { DEFAULT_LOCALE, isLocale, LOCALE_TAG, pickLocale, type Locale } from '../../shared/utils/locale'

/** 'auto' follows the phone's language; picked per device in Settings, like the look. */
export type LocaleChoice = Locale | 'auto'
const KEY = 'enduro.locale'
const DICTS: Record<Locale, Messages> = { en, pt }

type Store = Pick<Storage, 'getItem' | 'setItem'>

export function readLocaleChoice(s: Store | null): LocaleChoice {
  try {
    const v = s?.getItem(KEY)
    return isLocale(v) ? v : 'auto'
  } catch {
    return 'auto' // private mode, blocked storage
  }
}

export function saveLocaleChoice(s: Store | null, choice: LocaleChoice) {
  try {
    s?.setItem(KEY, choice)
  } catch {
    // still applied for this visit
  }
}

/** The phone's language, when the app speaks it. */
export function phoneLocale(nav: { languages?: readonly string[]; language?: string } | null = typeof navigator === 'undefined' ? null : navigator): Locale {
  if (!nav) return DEFAULT_LOCALE
  return pickLocale(nav.languages?.length ? nav.languages : [nav.language ?? ''])
}

export const resolveLocale = (choice: LocaleChoice, phone: Locale = phoneLocale()): Locale => (choice === 'auto' ? phone : choice)

/** The language in use right now (reactive). */
export const activeLocale = ref<Locale>(DEFAULT_LOCALE)

export function setActiveLocale(l: Locale) {
  activeLocale.value = l
  if (typeof document !== 'undefined') document.documentElement.lang = LOCALE_TAG[l]
}

/** The words for the language in use; read inside render/computed to stay reactive. */
export const msgs = (): Messages => DICTS[activeLocale.value]
export const messagesFor = (l: Locale): Messages => DICTS[l]
