/**
 * FILE: apps/admin/src/lib/hubViewSlot.tsx
 * PURPOSE: A page hub's view switcher (Today / Overview / User activity …)
 *          belongs under the page title, not above it. Every non-hub page
 *          leads with its PageHeaderBar, and page-scaffold's canonical order
 *          is PageHeaderBar → PagePosture → SegmentedControl; a hub rendered
 *          the strip above the whole page, so Home opened with tabs and the
 *          title came second (report 04f7bd36).
 *
 * OVERVIEW:
 * - `HubViewSlotProvider` carries the hub's switcher down to the active view.
 * - `useHubViewSwitcher` lets `PageHeaderBar` claim it and render it below the
 *   title row.
 * - A view that renders no header — a skeleton, an empty state, a load error —
 *   claims nothing, and the provider keeps drawing the switcher itself so the
 *   user can always switch views.
 *
 * DEPENDENCIES: react only. No router, no data.
 *
 * USAGE: `components/PageHubView.tsx` provides, `components/PageHeaderBar.tsx`
 *        consumes. Nothing else should need either half.
 *
 * NOTES: The claim is a count, not a flag, so a view that swaps one header for
 *        another (mount before unmount) never drops the switcher. The claim
 *        runs in a layout effect, so the hand-off commits before paint.
 */

import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

interface HubViewSlotValue {
  switcher: ReactNode
  claimed: boolean
  /** Claim the switcher for a page header; the returned callback releases it. */
  claim: () => () => void
}

const HubViewSlotContext = createContext<HubViewSlotValue | null>(null)

export function HubViewSlotProvider({
  switcher,
  children,
}: {
  switcher: ReactNode
  children: ReactNode
}) {
  const [claims, setClaims] = useState(0)
  const claim = useCallback(() => {
    setClaims((n) => n + 1)
    return () => setClaims((n) => n - 1)
  }, [])
  const claimed = claims > 0
  const value = useMemo(() => ({ switcher, claimed, claim }), [switcher, claimed, claim])
  return (
    <HubViewSlotContext.Provider value={value}>
      {!claimed && switcher}
      {children}
    </HubViewSlotContext.Provider>
  )
}

/**
 * The hub switcher this page header owns, or null outside a hub. Claiming is
 * the point of the hook — call it once per page header and render what it
 * returns.
 */
export function useHubViewSwitcher(): ReactNode | null {
  const ctx = useContext(HubViewSlotContext)
  const claim = ctx?.claim
  useLayoutEffect(() => claim?.(), [claim])
  return ctx?.claimed ? ctx.switcher : null
}
