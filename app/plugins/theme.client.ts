import { applyTheme, applyThemeColor, readTheme } from '~/lib/theme'

// Before the app mounts, so the first paint already has the rider's look.
export default defineNuxtPlugin(() => {
  let s: Storage | null
  try {
    s = localStorage
  } catch {
    s = null // blocked storage: the default look
  }
  const id = readTheme(s)
  applyTheme(document.documentElement, id)
  applyThemeColor(document, id)
})
