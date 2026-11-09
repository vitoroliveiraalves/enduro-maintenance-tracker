/** How many `Sheet`s are open right now (the mic hides while any is). */
const openSheets = ref(0)

export function useSheets() {
  return { openSheets }
}
