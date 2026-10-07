/**
 * FILE: apps/admin/src/components/PageHubView.tsx
 * PURPOSE: The view switcher for a page hub (lib/pageHubs.ts): one row of
 *          views above the page, `?view=` in the URL, gated views hidden.
 */

import { Suspense, type ReactNode } from 'react'
import { Navigate, useLocation, useSearchParams } from 'react-router-dom'
import { Loading, SegmentedControl } from './ui'
import { useEntitlements } from '../lib/useEntitlements'
import { hubRedirectTarget, resolveHubView, visibleViews, type PageHub } from '../lib/pageHubs'

export function PageHubView({ hub, render }: { hub: PageHub; render: Record<string, () => ReactNode> }) {
  const [searchParams, setSearchParams] = useSearchParams()
  const entitlements = useEntitlements()
  const views = visibleViews(hub, entitlements)
  const view = resolveHubView(hub, searchParams.get('view'), entitlements)

  const select = (id: string) => {
    const next = new URLSearchParams(searchParams)
    if (id === hub.views[0].id) next.delete('view')
    else next.set('view', id)
    setSearchParams(next, { replace: true })
  }

  return (
    <div className="flex w-full min-w-0 flex-col gap-3">
      {views.length > 1 && (
        <div className="max-w-full overflow-x-auto">
          <SegmentedControl<string>
            value={view}
            options={views.map((v) => ({ id: v.id, label: v.label }))}
            onChange={select}
            ariaLabel={hub.title}
            size="sm"
            scrollable
          />
        </div>
      )}
      <Suspense fallback={<Loading text="Loading…" />}>{render[view]?.()}</Suspense>
    </div>
  )
}

/** A retired route: open its hub view, query kept. */
export function HubRedirect({ hub, viewId }: { hub: PageHub; viewId: string }) {
  const { search } = useLocation()
  return <Navigate to={hubRedirectTarget(hub, viewId, search)} replace />
}
