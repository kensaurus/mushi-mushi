/**
 * FILE: apps/admin/src/components/PageHubView.tsx
 * PURPOSE: The view switcher for a page hub (lib/pageHubs.ts): one row of
 *          views under the page title (hubViewSlot), `?view=` in the URL,
 *          gated views hidden unless a link asks for one: then it says which
 *          plan has it. A view with no page header keeps the row above it.
 */

import { Suspense, type ReactNode } from 'react'
import { Navigate, useLocation, useSearchParams } from 'react-router-dom'
import { Loading, SegmentedControl } from './ui'
import { HubViewSlotFrame, HubViewSlotProvider } from './hubViewSlot'
import { LockedHubView } from './LockedHubView'
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

  const tabs =
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
    <HubViewSlotProvider tabs={tabs}>
      <HubViewSlotFrame>
        {entitlements.loading && requested && hub.views.some((v) => v.id === requested && v.requiresFeature) ? (
          <Loading text="Loading…" />
        ) : locked ? (
          <LockedHubView view={locked} currentPlan={entitlements.planName} />
        ) : (
          <Suspense fallback={<Loading text="Loading…" />}>{render[view]?.()}</Suspense>
        )}
      </HubViewSlotFrame>
    </HubViewSlotProvider>
  )
}

/** A retired route: open its hub view, query kept. */
export function HubRedirect({ hub, viewId }: { hub: PageHub; viewId: string }) {
  const { search } = useLocation()
  return <Navigate to={hubRedirectTarget(hub, viewId, search)} replace />
}
