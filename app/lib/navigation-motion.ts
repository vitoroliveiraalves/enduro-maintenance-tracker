/**
 * Directional page transition helper.
 * Determines the animation direction based on route hierarchy and tab index:
 * - 'slide-left': Forward tab movement (e.g. Garage -> History) or drill-down push (Garage -> Bike detail)
 * - 'slide-right': Backward tab movement (e.g. Costs -> History) or hierarchical pop (Bike detail -> Garage)
 * - 'slide-up': Modal presentation flows (e.g. Garage -> Add Vehicle wizard)
 * - 'slide-down': Modal dismiss flows (e.g. Add Vehicle -> Garage)
 */

export type NavigationDirection = 'slide-left' | 'slide-right' | 'slide-up' | 'slide-down'

const TAB_ORDER: Record<string, number> = {
  '/': 0,
  '/history': 1,
  '/invoice': 2,
  '/costs': 3,
  '/shelf': 4,
  '/settings': 5,
}

export function getNavigationDirection(fromPath: string, toPath: string): NavigationDirection {
  if (!fromPath || !toPath || fromPath === toPath) return 'slide-left'

  // 1. Modal creation flows (e.g. /bikes/new): slides up from bottom; dismiss slides down
  if (toPath === '/bikes/new' || toPath.endsWith('/new')) {
    return 'slide-up'
  }
  if (fromPath === '/bikes/new' || fromPath.endsWith('/new')) {
    return 'slide-down'
  }

  // 2. Hierarchical Drill-down (Push & Pop)
  // If moving from a parent route to a child/detail route: push (slide-left)
  const isPush =
    (fromPath === '/' && toPath.startsWith('/bikes/')) ||
    (fromPath === '/invoice' && toPath.startsWith('/invoice/')) ||
    (toPath.startsWith(fromPath.endsWith('/') ? fromPath : `${fromPath}/`))

  if (isPush) {
    return 'slide-left'
  }

  // If moving from a child/detail route back to its parent: pop (slide-right)
  const isPop =
    (toPath === '/' && fromPath.startsWith('/bikes/')) ||
    (toPath === '/invoice' && fromPath.startsWith('/invoice/')) ||
    (fromPath.startsWith(toPath.endsWith('/') ? toPath : `${toPath}/`))

  if (isPop) {
    return 'slide-right'
  }

  // 3. Tab index comparison
  const findTabBase = (p: string) => {
    if (p === '/') return '/'
    const base = Object.keys(TAB_ORDER).find((key) => key !== '/' && p.startsWith(key))
    return base ?? '/'
  }

  const fromBase = findTabBase(fromPath)
  const toBase = findTabBase(toPath)

  const fromIdx = TAB_ORDER[fromBase] ?? 0
  const toIdx = TAB_ORDER[toBase] ?? 0

  if (fromIdx !== toIdx) {
    return toIdx > fromIdx ? 'slide-left' : 'slide-right'
  }

  return 'slide-left'
}
