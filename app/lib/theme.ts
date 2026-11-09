/** The app's looks. Chosen per device in Settings; Stamped Steel unless the rider picks another. */
export const THEMES = [
  { id: 'steel', name: 'Stamped Steel', hint: 'Black and white, workshop tags' },
  { id: 'tricolor', name: 'Old-school tricolor', hint: 'Red, white and blue, 80s motocross' },
] as const
export type ThemeId = (typeof THEMES)[number]['id']
export const DEFAULT_THEME: ThemeId = 'steel'
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
