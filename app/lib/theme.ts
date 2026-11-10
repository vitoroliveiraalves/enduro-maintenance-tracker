/** The app's looks. Chosen per device in Settings; the tricolor unless the rider picks another. */
export const THEMES = [
  { id: 'steel', name: 'Stamped Steel', hint: 'Black and white, workshop tags' },
  { id: 'tricolor', name: 'Old-school tricolor', hint: 'Red, white and blue, 80s motocross' },
] as const
export type ThemeId = (typeof THEMES)[number]['id']
/** Status bar / browser chrome colour per look: the look's `bg` token (main.css). */
export const THEME_COLORS: Record<ThemeId, string> = { steel: '#0e0e0e', tricolor: '#0f1012' }
export const DEFAULT_THEME: ThemeId = 'tricolor'
const KEY = 'enduro.theme'

type Store = Pick<Storage, 'getItem' | 'setItem'>
const isTheme = (v: unknown): v is ThemeId => THEMES.some((t) => t.id === v)

export function readTheme(s: Store | null): ThemeId {
  try {
    const v = s?.getItem(KEY)
    return isTheme(v) ? v : DEFAULT_THEME
  } catch {
    return DEFAULT_THEME // private mode, blocked storage
  }
}

export function saveTheme(s: Store | null, id: ThemeId) {
  try {
    s?.setItem(KEY, id)
  } catch {
    // still applied for this visit
  }
}

export function applyTheme(el: { dataset: Record<string, string | undefined> }, id: ThemeId) {
  el.dataset.theme = id
}

/** Point the `theme-color` meta at the look's background so the status bar matches. */
export function applyThemeColor(doc: { querySelector(sel: string): { setAttribute(k: string, v: string): void } | null }, id: ThemeId) {
  doc.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLORS[id])
}
