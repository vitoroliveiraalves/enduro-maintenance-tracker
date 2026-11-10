import { tick } from '~/lib/haptics'

/** One short confirmation at a time ("Ride saved · 145.0 h"), shown above the tabs, optionally with one action ("Undo"). */
type Action = { label: string; run: () => unknown }
const message = ref('')
const action = shallowRef<Action | null>(null)
let timer: ReturnType<typeof setTimeout> | null = null

export function useToast() {
  function show(text: string, opts: number | { ms?: number; action?: Action } = {}) {
    const o = typeof opts === 'number' ? { ms: opts } : opts
    message.value = text
    tick() // every save/delete confirmation is also felt
    action.value = o.action ?? null
    if (timer) clearTimeout(timer)
    timer = setTimeout(hide, o.ms ?? (o.action ? 8000 : 4000))
  }
  function hide() {
    message.value = ''
    action.value = null
  }
  async function act() {
    const a = action.value
    hide()
    await a?.run()
  }
  return { message, action, show, hide, act }
}
