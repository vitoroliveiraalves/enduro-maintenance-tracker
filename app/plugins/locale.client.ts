import { readLocaleChoice, resolveLocale, setActiveLocale } from '~/lib/i18n'

// Before the app mounts, so the first paint is already in the rider's language.
export default defineNuxtPlugin(() => {
  let s: Storage | null
  try {
    s = localStorage
  } catch {
    s = null
  }
  setActiveLocale(resolveLocale(readLocaleChoice(s)))
})
