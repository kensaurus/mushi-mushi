import { describe, expect, it } from 'vitest'
import { HEALTH_HUB, HOME_HUB, TEAM_HUB, hubRedirectTarget, legacyHubRoutes, resolveHubView, visibleViews } from './pageHubs'

const viewer = (over: Partial<{ isOperator: boolean; isSuperAdmin: boolean; flags: string[] }> = {}) => ({
  isOperator: over.isOperator ?? false,
  isSuperAdmin: over.isSuperAdmin ?? false,
  has: (flag: string) => (over.flags ?? []).includes(flag),
})

describe('page hubs', () => {
  it('falls back to the first view and hides operator-only views', () => {
    expect(resolveHubView(HOME_HUB, null, viewer())).toBe('today')
    expect(resolveHubView(HOME_HUB, 'nope', viewer())).toBe('today')
    expect(resolveHubView(HOME_HUB, 'users', viewer())).toBe('users')
    expect(resolveHubView(HOME_HUB, 'growth', viewer())).toBe('today')
    expect(resolveHubView(HOME_HUB, 'growth', viewer({ isOperator: true }))).toBe('growth')
  })

  it('shows plan-gated Team views only to teams that have the feature', () => {
    expect(visibleViews(TEAM_HUB, viewer()).map((v) => v.id)).toEqual(['billing', 'spend', 'storage'])
    expect(visibleViews(TEAM_HUB, viewer({ flags: ['teams', 'sso'] })).map((v) => v.id)).toEqual(['members', 'billing', 'spend', 'sso', 'storage'])
    expect(resolveHubView(TEAM_HUB, null, viewer())).toBe('billing')
    expect(visibleViews(TEAM_HUB, viewer({ isSuperAdmin: true }))).toHaveLength(TEAM_HUB.views.length)
  })

  it('redirects every retired route to its view and keeps the query', () => {
    expect(hubRedirectTarget(HOME_HUB, 'users', '?project=p1')).toBe('/dashboard?project=p1&view=users')
    expect(hubRedirectTarget(HEALTH_HUB, 'code', '')).toBe('/health?view=code')
    expect(hubRedirectTarget(TEAM_HUB, 'members', '?tab=roles')).toBe('/team?tab=roles')
    expect(legacyHubRoutes().map((r) => r.path).sort()).toEqual(
      ['/activity', '/analytics', '/anomalies', '/audit', '/billing', '/code-health', '/compliance', '/cost', '/drift', '/growth', '/intelligence', '/organization/members', '/overview', '/sso', '/storage'].sort(),
    )
  })
})
