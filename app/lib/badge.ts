/** Home-screen icon badge: how many maintenance items are overdue across all bikes. */
export function overdueTotal(bikes: Array<{ counts: { overdue: number } }>): number {
  return bikes.reduce((n, b) => n + (b.counts.overdue || 0), 0)
}

type BadgeNav = { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> }

/** Set (or clear at 0) the app badge. Unsupported browsers and denied permission are silent no-ops. */
export async function setBadge(nav: BadgeNav, count: number) {
  try {
    if (count > 0) await nav.setAppBadge?.(count)
    else await nav.clearAppBadge?.()
  } catch {
    // no badge permission: nothing to do
  }
}
