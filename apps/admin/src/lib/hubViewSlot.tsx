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
 * - `useHubViewSwitcher` lets the first `PageHeaderBar` claim the switcher and
 *   render it below the title row. A later header in the same view does not
 *   draw a second copy.
 * - A view that renders no header — a skeleton, an empty state, a load error —
 *   claims nothing, and the provider keeps drawing the switcher itself so the
 *   user can always switch views.
 *
 * DEPENDENCIES: react only. No router, no data.
 *
 * USAGE: `components/PageHubView.tsx` provides, `components/PageHeaderBar.tsx`
 *        consumes. Nothing else should need either half.
 *
 * NOTES: Claim order is a list of header ids, not a count. Only the first id
 *        renders the switcher, so a nested section header does not draw a
 *        second Today / Overview bar. Later headers still claim: when the
 *        first unmounts, the next id takes the switcher, and a swap (mount
 *        before unmount) never drops it. The claim runs in a layout effect,
 *        so the hand-off commits before paint.
 */

import {
  createContext,
  useCallback,
  useContext,
  useId,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

interface HubViewSlotValue {
  switcher: ReactNode
  /** First header that claimed the switcher, or null when none have. */
  ownerId: string | null
  /** Claim the switcher for this header id; the returned callback releases it. */
  claim: (id: string) => () => void
}

const HubViewSlotContext = createContext<HubViewSlotValue | null>(null)

export function HubViewSlotProvider({
  switcher,
  children,
}: {
  switcher: ReactNode
  children: ReactNode
}) {
  const [owners, setOwners] = useState<string[]>([])
  const claim = useCallback((id: string) => {
    setOwners((current) => (current.includes(id) ? current : [...current, id]))
    return () => {
      setOwners((current) => {
        if (!current.includes(id)) return current
        return current.filter((owner) => owner !== id)
      })
    }
  }, [])
  const ownerId = owners[0] ?? null
  const value = useMemo(() => ({ switcher, ownerId, claim }), [switcher, ownerId, claim])
  return (
    <HubViewSlotContext.Provider value={value}>
      {ownerId == null && switcher}
      {children}
    </HubViewSlotContext.Provider>
  )
}

/**
 * The hub switcher this page header owns, or null outside a hub and for every
 * header after the first. Claiming is the point of the hook — call it once
 * per page header and render what it returns. Only the first claimant in the
 * view gets the node, so two PageHeaderBars do not draw two tab bars.
 */
export function useHubViewSwitcher(): ReactNode | null {
  const ctx = useContext(HubViewSlotContext)
  const id = useId()
  const claim = ctx?.claim
  useLayoutEffect(() => {
    if (!claim) return
    return claim(id)
  }, [claim, id])
  if (!ctx || ctx.ownerId !== id) return null
  return ctx.switcher
}
