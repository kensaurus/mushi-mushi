/**
 * FILE: apps/admin/src/components/PageHeaderTabs.tsx
 * PURPOSE: A hub's view tabs sit under the page title, not above it (ADR 0066).
 *
 * The hub (PageHubView, HealthPage) does not render the page's header: each
 * view is a whole page with its own PageHeaderBar. So the hub hands its tabs
 * down through this context, and the first PageHeaderBar that mounts under it
 * claims them and draws them below its title row. Until one claims them (a
 * view still loading, an error state, a page without a PageHeaderBar) the hub
 * draws them itself at the top, so the tabs never disappear.
 */

import { createContext, useCallback, useContext, useId, useLayoutEffect, useMemo, useState, type ReactNode } from 'react'

interface HeaderTabsSlot {
  tabs: ReactNode
  claimant: string | null
  claim: (id: string) => void
  release: (id: string) => void
}

const HeaderTabsContext = createContext<HeaderTabsSlot | null>(null)

/** Wrap a hub's view: `tabs` render under that view's page title, or above it until a title claims them. */
export function PageHeaderTabsProvider({ tabs, children }: { tabs: ReactNode; children: ReactNode }) {
  const [claimant, setClaimant] = useState<string | null>(null)
  const claim = useCallback((id: string) => setClaimant((cur) => cur ?? id), [])
  const release = useCallback((id: string) => setClaimant((cur) => (cur === id ? null : cur)), [])
  const slot = useMemo(() => ({ tabs, claimant, claim, release }), [tabs, claimant, claim, release])
  return (
    <HeaderTabsContext.Provider value={slot}>
      {tabs && claimant === null ? <div data-testid="page-header-tabs-fallback">{tabs}</div> : null}
      {children}
    </HeaderTabsContext.Provider>
  )
}

/**
 * Called by PageHeaderBar: the hub's tabs when this header is the one that
 * shows them, else null. Only the first header under a hub claims them, so a
 * second header inside the page (a drawer, a panel) never repeats them.
 */
export function useClaimedHeaderTabs(): ReactNode {
  const slot = useContext(HeaderTabsContext)
  const id = useId()
  const claim = slot?.claim
  const release = slot?.release
  // Layout effect: the claim lands before paint, so the tabs never flash at the top first.
  useLayoutEffect(() => {
    if (!claim || !release) return
    claim(id)
    return () => release(id)
  }, [claim, release, id])
  return slot && slot.claimant === id ? slot.tabs : null
}
