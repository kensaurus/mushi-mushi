import { describe, expect, it } from 'vitest'
import { APPS_HUB, HEALTH_HUB, TEAM_HUB, homeViewRedirect, hubRedirectTarget, hubViewLabel, legacyHubRoutes, lockedHubView, resolveHubView, visibleViews } from './pageHubs'

const viewer = (over: Partial<{ isOperator: boolean; isSuperAdmin: boolean; flags: string[] }> = {}) => ({
  isOperator: over.isOperator ?? false,
  isSuperAdmin: over.isSuperAdmin ?? false,
  has: (flag: string) => (over.flags ?? []).includes(flag),
})

describe('page hubs', () => {
  it('falls back to the first view and hides operator-only views', () => {
    expect(resolveHubView(APPS_HUB, null, viewer())).toBe('all')
    expect(resolveHubView(APPS_HUB, 'nope', viewer())).toBe('all')
    expect(resolveHubView(APPS_HUB, 'users', viewer())).toBe('users')
    expect(resolveHubView(APPS_HUB, 'growth', viewer())).toBe('all')
    expect(resolveHubView(APPS_HUB, 'growth', viewer({ isOperator: true }))).toBe('growth')
  })

  it('shows plan-gated Team views only to teams that have the feature', () => {
    expect(visibleViews(TEAM_HUB, viewer()).map((v) => v.id)).toEqual(['billing', 'spend', 'storage'])
    expect(visibleViews(TEAM_HUB, viewer({ flags: ['teams', 'sso'] })).map((v) => v.id)).toEqual(['members', 'billing', 'spend', 'sso', 'storage'])
    expect(resolveHubView(TEAM_HUB, null, viewer())).toBe('billing')
    expect(visibleViews(TEAM_HUB, viewer({ isSuperAdmin: true }))).toHaveLength(TEAM_HUB.views.length)
  })

  it('redirects every retired route to its view and keeps the query', () => {
    expect(hubRedirectTarget(APPS_HUB, 'users', '?project=p1')).toBe('/portfolio?project=p1&view=users')
    expect(hubRedirectTarget(HEALTH_HUB, 'code', '')).toBe('/health?view=code')
    expect(hubRedirectTarget(TEAM_HUB, 'members', '?tab=roles')).toBe('/team?tab=roles')
    expect(legacyHubRoutes().map((r) => r.path).sort()).toEqual(
      ['/activity', '/analytics', '/anomalies', '/audit', '/billing', '/code-health', '/compliance', '/cost', '/drift', '/growth', '/intelligence', '/organization/members', '/overview', '/sso', '/storage'].sort(),
    )
  })

  // ?view=sso and ?view=compliance silently rendered Members (console
  // journeys 2026-10-27): a view the plan lacks is "locked", not swapped.
  it('names a plan-gated view the viewer lacks as locked, never an operator view', () => {
    expect(lockedHubView(TEAM_HUB, 'sso', viewer())?.id).toBe('sso')
    expect(lockedHubView(TEAM_HUB, 'compliance', viewer({ flags: ['teams'] }))?.id).toBe('compliance')
    expect(lockedHubView(TEAM_HUB, 'sso', viewer({ flags: ['sso'] }))).toBeNull()
    expect(lockedHubView(TEAM_HUB, 'sso', viewer({ isSuperAdmin: true }))).toBeNull()
    expect(lockedHubView(TEAM_HUB, 'billing', viewer())).toBeNull()
    expect(lockedHubView(TEAM_HUB, null, viewer())).toBeNull()
    expect(lockedHubView(APPS_HUB, 'growth', viewer())).toBeNull()
  })
})

// Console audit 2026-11-21: every Team view titled the browser tab just "Team".
describe('hubViewLabel', () => {
  it('names a hub view other than the first, and nothing else', () => {
    expect(hubViewLabel('/team', '?view=billing')).toBe('Billing')
    expect(hubViewLabel('/team', '?view=members')).toBeNull()
    expect(hubViewLabel('/team', '')).toBeNull()
    expect(hubViewLabel('/team', '?view=nope')).toBeNull()
    expect(hubViewLabel('/portfolio', '?view=apps&project=p1')).toBe('Overview')
    expect(hubViewLabel('/dashboard', '?view=apps')).toBeNull()
    expect(hubViewLabel('/reports', '?view=apps')).toBeNull()
  })
})

// ADR 0069: Home has no view tabs; every link to one of its old views opens that view under Apps.
describe('homeViewRedirect', () => {
  it('sends each former Home view to Apps with the query kept, and leaves Home itself alone', () => {
    expect(homeViewRedirect('?view=users')).toBe('/portfolio?view=users')
    expect(homeViewRedirect('?project=p1&view=funnels')).toBe('/portfolio?project=p1&view=funnels')
    for (const id of ['apps', 'insights', 'growth']) expect(homeViewRedirect(`?view=${id}`)).toBe(`/portfolio?view=${id}`)
    expect(homeViewRedirect('')).toBeNull()
    expect(homeViewRedirect('?view=today')).toBeNull()
    expect(homeViewRedirect('?view=nope&project=p1')).toBeNull()
    // `all` is Apps' own first view, never a Home view.
    expect(homeViewRedirect('?view=all')).toBeNull()
  })
})
