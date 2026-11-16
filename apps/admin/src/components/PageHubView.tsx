/**
 * FILE: apps/admin/src/components/PageHubView.tsx
 * PURPOSE: The view switcher for a page hub (lib/pageHubs.ts): one row of
 *          views under the page title, `?view=` in the URL, gated views
 *          hidden unless a link asks for one: then it says which plan has it.
 *
 *          The row is portaled into the first PageHeaderBar in DOM order
 *          (tree order, not whichever header mounted first). A view with no
 *          header — a skeleton, an error — keeps the row above the content.
 *          Placement is measured in useLayoutEffect, before paint, so Home
 *          (whose title is in the first render) does not flash the row above
 *          the title. A header that appears later, after a headerless
 *          skeleton, moves the row under the title once.
 */

import { Suspense, useCallback, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Navigate, useLocation, useSearchParams } from 'react-router-dom'
import { Loading, SegmentedControl } from './ui'
import { LockedHubView } from './LockedHubView'
import { HubTabsRecomputeContext } from './hubViewSlot'
import { useEntitlements } from '../lib/useEntitlements'
import { hubRedirectTarget, lockedHubView, resolveHubView, visibleViews, type PageHub } from '../lib/pageHubs'

export function PageHubView({ hub, render }: { hub: PageHub; render: Record<string, () => ReactNode> }) {
  const [searchParams, setSearchParams] = useSearchParams()
  const entitlements = useEntitlements()
  const views = visibleViews(hub, entitlements)
  const requested = searchParams.get('view')
  // A plan-gated view the link asks for is shown as locked, not swapped for
  // the first view. While entitlements load, every gate reads "no": wait.
  const locked = entitlements.loading ? null : lockedHubView(hub, requested, entitlements)
  const view = locked ? locked.id : resolveHubView(hub, requested, entitlements)
  const options = locked ? hub.views.filter((v) => v === locked || views.includes(v)) : views

  const select = (id: string) => {
    const next = new URLSearchParams(searchParams)
    if (id === hub.views[0].id) next.delete('view')
    else next.set('view', id)
    setSearchParams(next, { replace: true })
  }

  const rootRef = useRef<HTMLDivElement>(null)
  const [placement, setPlacement] = useState<{ settled: boolean; anchor: HTMLElement | null }>({
    settled: false,
    anchor: null,
  })
  const recompute = useCallback(() => {
    const root = rootRef.current
    // Unmounting the hub disconnects the root; skip so we don't set state then.
    if (!root?.isConnected) return
    const anchor = root.querySelector<HTMLElement>('[data-page-header]')
    setPlacement((prev) => (prev.settled && prev.anchor === anchor ? prev : { settled: true, anchor }))
  }, [])
  // Headerless views never notify. A view change also remeasures after the
  // new page's header is in the DOM.
  useLayoutEffect(() => {
    recompute()
  }, [recompute, view])

  const tabStrip =
    options.length > 1 ? (
      <div className="max-w-full overflow-x-auto" data-testid="hub-view-tabs">
        <SegmentedControl<string>
          value={view}
          options={options.map((v) => ({ id: v.id, label: v.label }))}
          onChange={select}
          ariaLabel={hub.title}
          size="sm"
          scrollable
        />
      </div>
    ) : null

  return (
    <HubTabsRecomputeContext.Provider value={recompute}>
      <div ref={rootRef} className="flex w-full min-w-0 flex-col gap-3">
        {tabStrip && placement.anchor
          ? createPortal(<div className="mt-2">{tabStrip}</div>, placement.anchor)
          : tabStrip && placement.settled
            ? tabStrip
            : null}
        {entitlements.loading && requested && hub.views.some((v) => v.id === requested && v.requiresFeature) ? (
          <Loading text="Loading…" />
        ) : locked ? (
          <LockedHubView view={locked} currentPlan={entitlements.planName} />
        ) : (
          <Suspense fallback={<Loading text="Loading…" />}>{render[view]?.()}</Suspense>
        )}
      </div>
    </HubTabsRecomputeContext.Provider>
  )
}

/** A retired route: open its hub view, query kept. */
export function HubRedirect({ hub, viewId }: { hub: PageHub; viewId: string }) {
  const { search } = useLocation()
  return <Navigate to={hubRedirectTarget(hub, viewId, search)} replace />
}
