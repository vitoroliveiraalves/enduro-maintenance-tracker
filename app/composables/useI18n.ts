import { computed } from 'vue'
import { activeLocale, msgs, phoneLocale, readLocaleChoice, resolveLocale, saveLocaleChoice, setActiveLocale, type LocaleChoice } from '~/lib/i18n'

const storage = () => (typeof localStorage === 'undefined' ? null : localStorage)

/**
 * `t` is the dictionary for the language in use (`t.settings.title`, `t.x.count(n)`);
 * `choose` saves 'auto' | 'en' | 'pt' on this device and switches at once.
 */
export function useI18n() {
  const choice = useState<LocaleChoice>('locale-choice', () => readLocaleChoice(storage()))
  const t = computed(msgs)
  function choose(c: LocaleChoice) {
    choice.value = c
    saveLocaleChoice(storage(), c)
    setActiveLocale(resolveLocale(c))
  }
  return { t, locale: activeLocale, choice, choose, phone: phoneLocale }
}
