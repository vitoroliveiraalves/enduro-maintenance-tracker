import { msgs } from './i18n'

/** A server message (English) in the language in use; unknown ones stay as they are. */
export function serverText(text: string): string {
  for (const [re, out] of msgs().server) {
    const m = re.exec(text)
    if (m) return typeof out === 'string' ? out : out(...m.slice(1).map(serverText))
  }
  return text
}

/** A default category or template item name in the language in use; anything the rider named stays. */
export const categoryLabel = (name: string): string => msgs().seeded.categories[name] ?? name
export const itemLabel = (name: string): string => msgs().seeded.items[name] ?? name
