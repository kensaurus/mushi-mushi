/**
 * FILE: apps/admin/src/components/hubViewSlot.tsx
 * PURPOSE: Tell a page hub to place its view tabs again when a page header
 *          mounts or unmounts. PageHubView owns the tabs and portals them
 *          into the first header in DOM order. Outside a hub this is a no-op.
 *
 * DEPENDENCIES: React context. PageHeaderBar calls useNotifyHubTabs;
 *               PageHubView provides HubTabsRecomputeContext.
 */

import { createContext, useContext, useLayoutEffect, type RefObject } from 'react'

/** Stable callback from PageHubView. Null when the header is not inside a hub. */
export const HubTabsRecomputeContext = createContext<(() => void) | null>(null)

/**
 * Register this header with the surrounding hub. The hub chooses the first
 * header in tree order itself, so a header that mounts later but sits higher
 * on the page still wins.
 */
export function useNotifyHubTabs(ref: RefObject<HTMLElement | null>): void {
  const recompute = useContext(HubTabsRecomputeContext)
  useLayoutEffect(() => {
    if (!recompute) return
    if (ref.current) recompute()
    return () => {
      recompute()
    }
  }, [recompute, ref])
}
