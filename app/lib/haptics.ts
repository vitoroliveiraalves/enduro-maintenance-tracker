/** A short tick on save, delete and tab change. Android only: iOS Safari has no vibrate, so it is a silent no-op there. */
export function tick(nav: { vibrate?: (p: number) => boolean } | undefined = typeof navigator === 'undefined' ? undefined : navigator) {
  try {
    nav?.vibrate?.(10)
  } catch {
    // blocked by the browser or the user: nothing to do
  }
}
