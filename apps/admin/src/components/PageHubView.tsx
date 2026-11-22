/**
 * FILE: apps/admin/src/components/PageHubView.tsx
 * PURPOSE: The view switcher for a page hub (lib/pageHubs.ts): one row of
 *          views under the page title (ADR 0066; it sat above the title
 *          under Plan 021), `?view=` in the URL, gated views hidden unless a
 *          link asks for one: then it says which plan has it.
 */

import { Suspense, type ReactNode } from 'react'
import { Navigate, useLocation, useSearchParams } from 'react-router-dom'
import { Loading, SegmentedControl } from './ui'
import { LockedHubView } from './LockedHubView'
import { PageHeaderTabsProvider } from './PageHeaderTabs'
import { useEntitlements } from '../lib/useEntitlements'
import { useEdgeFade } from '../lib/useEdgeFade'
import { useMediaQuery } from '../lib/useMediaQuery'
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
  // Phone: the view picker scrolls with a fade at the edge, never a raw scrollbar (fresh-eyes 2026-11-18).
  const fade = useEdgeFade<HTMLDivElement>(options.length)
  // Phone: the views wrap onto a second row; the scroll strip still showed a native scrollbar
  // and cut "Storag" at the edge (2026-11-19).
  const wide = useMediaQuery('(min-width: 640px)', true)

  const select = (id: string) => {
    const next = new URLSearchParams(searchParams)
    if (id === hub.views[0].id) next.delete('view')
    else next.set('view', id)
    setSearchParams(next, { replace: true })
  }

  const tabs =
    options.length < 2 ? null : wide ? (
      <div ref={fade.ref} className={`max-w-full overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${fade.className}`}>
        <SegmentedControl<string>
          value={view}
          options={options.map((v) => ({ id: v.id, label: v.label }))}
          onChange={select}
          ariaLabel={hub.title}
          size="sm"
          scrollable
        />
      </div>
    ) : (
      <SegmentedControl<string>
        value={view}
        options={options.map((v) => ({ id: v.id, label: v.label }))}
        onChange={select}
        ariaLabel={hub.title}
        size="sm"
        wrap
      />
    )

  // The tabs go to the view's PageHeaderBar, under its title (ADR 0066): the
  // title is the first thing on screen and the tabs read as parts of it.
  return (
    <div className="flex w-full min-w-0 flex-col gap-3">
      <PageHeaderTabsProvider tabs={tabs}>
        {entitlements.loading && requested && hub.views.some((v) => v.id === requested && v.requiresFeature) ? (
          <Loading text="Loading…" />
        ) : locked ? (
          <LockedHubView view={locked} currentPlan={entitlements.planName} />
        ) : (
          <Suspense fallback={<Loading text="Loading…" />}>{render[view]?.()}</Suspense>
        )}
      </PageHeaderTabsProvider>
    </div>
  )
}

/** A retired route: open its hub view, query kept. */
export function HubRedirect({ hub, viewId }: { hub: PageHub; viewId: string }) {
  const { search } = useLocation()
  return <Navigate to={hubRedirectTarget(hub, viewId, search)} replace />
}
