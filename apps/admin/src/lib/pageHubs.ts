/**
 * FILE: apps/admin/src/lib/pageHubs.ts
 * PURPOSE: Pages that did one job from several angles are views of one page
 *          now (Plan 021 Phase 3, owner 2026-10-06), switched with `?view=`:
 *
 *            Home (/dashboard)  — Today, Overview, User activity, Users & funnels, Weekly insights, Growth
 *            Mushi health (/health) — Mushi's AI & jobs, Code size, Schema changes, Unusual spikes
 *            Team (/team)       — Members, Billing, AI spend, Audit log, Single sign-on, Compliance, Storage
 *
 *          Every retired route redirects to its view with the query kept, so
 *          old links, bookmarks and server-sent URLs keep working.
 */

import type { FeatureFlag } from './useEntitlements'

export interface HubView {
  id: string
  label: string
  /** The route this view replaced; it redirects to `<hub>?view=<id>`. */
  legacyPath: string | null
  operatorOnly?: boolean
  requiresFeature?: FeatureFlag
}

export interface PageHub {
  path: string
  /** Shown as the switcher's accessible name. */
  title: string
  views: readonly HubView[]
}

export const HOME_HUB: PageHub = {
  path: '/dashboard',
  title: 'Home view',
  views: [
    { id: 'today', label: 'Today', legacyPath: null },
    { id: 'apps', label: 'Overview', legacyPath: '/overview' },
    { id: 'users', label: 'User activity', legacyPath: '/activity' },
    { id: 'funnels', label: 'Users & funnels', legacyPath: '/analytics' },
    { id: 'insights', label: 'Weekly insights', legacyPath: '/intelligence' },
    { id: 'growth', label: 'Growth', legacyPath: '/growth', operatorOnly: true },
  ],
}

export const HEALTH_HUB: PageHub = {
  path: '/health',
  title: 'Mushi health view',
  views: [
    { id: 'integrations', label: 'Mushi’s AI & jobs', legacyPath: null },
    { id: 'code', label: 'Code size', legacyPath: '/code-health' },
    { id: 'schema', label: 'Schema changes', legacyPath: '/drift' },
    { id: 'spikes', label: 'Unusual spikes', legacyPath: '/anomalies' },
  ],
}

export const TEAM_HUB: PageHub = {
  path: '/team',
  title: 'Team view',
  views: [
    { id: 'members', label: 'Members', legacyPath: '/organization/members', requiresFeature: 'teams' },
    { id: 'billing', label: 'Billing', legacyPath: '/billing' },
    { id: 'spend', label: 'AI spend', legacyPath: '/cost' },
    { id: 'audit', label: 'Audit log', legacyPath: '/audit', requiresFeature: 'audit_log' },
    { id: 'sso', label: 'Single sign-on', legacyPath: '/sso', requiresFeature: 'sso' },
    { id: 'compliance', label: 'Compliance', legacyPath: '/compliance', requiresFeature: 'soc2' },
    { id: 'storage', label: 'Storage', legacyPath: '/storage' },
  ],
}

const PAGE_HUBS: readonly PageHub[] = [HOME_HUB, HEALTH_HUB, TEAM_HUB]

export interface HubViewer {
  isOperator: boolean
  isSuperAdmin: boolean
  has: (flag: FeatureFlag) => boolean
}

export function visibleViews(hub: PageHub, viewer: HubViewer): HubView[] {
  return hub.views.filter(
    (v) =>
      (!v.operatorOnly || viewer.isOperator) &&
      (!v.requiresFeature || viewer.has(v.requiresFeature) || viewer.isSuperAdmin),
  )
}

/** Unknown, missing or not-allowed views fall back to the hub's first view. */
export function resolveHubView(hub: PageHub, raw: string | null, viewer: HubViewer): string {
  const views = visibleViews(hub, viewer)
  return views.find((v) => v.id === raw)?.id ?? views[0]?.id ?? hub.views[0].id
}

/**
 * A view the URL asks for that the viewer's plan does not include. The hub
 * shows it as "Available on <plan>" instead of quietly opening its first
 * view: `?view=sso` used to render Members (console journeys 2026-10-27).
 * Operator-only views still fall back, since they are not for sale.
 */
export function lockedHubView(hub: PageHub, raw: string | null, viewer: HubViewer): HubView | null {
  const view = hub.views.find((v) => v.id === raw)
  if (!view?.requiresFeature || view.operatorOnly) return null
  return visibleViews(hub, viewer).some((v) => v.id === view.id) ? null : view
}

/** `/activity?project=x` → `/dashboard?project=x&view=users`, keeping every other param. */
export function hubRedirectTarget(hub: PageHub, viewId: string, search: string): string {
  const params = new URLSearchParams(search)
  if (viewId === hub.views[0].id) params.delete('view')
  else params.set('view', viewId)
  const qs = params.toString()
  return qs ? `${hub.path}?${qs}` : hub.path
}

/** Every retired route with its hub and view, for the router and the tests. */
export function legacyHubRoutes(): Array<{ path: string; hub: PageHub; viewId: string }> {
  return PAGE_HUBS.flatMap((hub) =>
    hub.views.filter((v) => v.legacyPath).map((v) => ({ path: v.legacyPath as string, hub, viewId: v.id })),
  )
}
