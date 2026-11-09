import { applyTheme, readTheme, saveTheme, THEMES, type ThemeId } from '~/lib/theme'

const storage = () => (typeof localStorage === 'undefined' ? null : localStorage)

/** The current look; `set` saves it on this device and repaints at once. */
export function useTheme() {
  const theme = useState<ThemeId>('theme', () => readTheme(storage()))
  function set(id: ThemeId) {
    theme.value = id
    saveTheme(storage(), id)
    applyTheme(document.documentElement, id)
  }
  return { theme, set, themes: THEMES }
}
