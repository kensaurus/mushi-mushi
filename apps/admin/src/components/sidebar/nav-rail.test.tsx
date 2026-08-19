/**
 * FILE: apps/admin/src/components/sidebar/nav-rail.test.tsx
 * PURPOSE: Contract tests for the collapsed sidebar rail.
 *
 * Two things are pinned here:
 *  1. The rail's accessibility wiring. An icon-only rail has no visible text,
 *     so the name must be on `aria-label` and the explanation must live in a
 *     real in-DOM `aria-describedby` target — the flyout is portaled and only
 *     exists while hovered, so it can never be the sole source.
 *  2. `navBadgeStatus` / `resolveNavBadge`. These were extracted so the rail
 *     and the expanded sidebar share one count derivation; the fallback gates
 *     are subtle enough (zero counts, hideWhenZero) to be worth locking down.
 *
 * Uses renderToStaticMarkup like the other admin .tsx tests — no DOM-testing
 * dependency, and the vitest surface stays narrow per vitest.config.ts.
 */

import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { NavRailLink, railBadgeText, railDescriptionId } from './NavRailLink'
import { NavRailFlyout } from './NavRailFlyout'
import { navBadgeStatus, resolveNavBadge, type NavBadgeSpec } from '../../lib/navBadges'
import { EMPTY_NAV_STAT_SLICES } from '../../lib/extendedNavMeta'
import type { NavCounts } from '../../lib/useNavCounts'

function StubIcon({ className }: { className?: string }) {
  return <svg className={className} data-testid="icon" />
}

function renderRail(props: Partial<Parameters<typeof NavRailLink>[0]> = {}) {
  return renderToStaticMarkup(
    <MemoryRouter>
      <NavRailLink
        to="/reports"
        label="Reports"
        description="Triage inbound bug reports — grouped, scored, ranked."
        icon={StubIcon}
        active={false}
        badge={null}
        {...props}
      />
    </MemoryRouter>,
  )
}

const NAV_COUNTS_ZERO: NavCounts = {
  untriagedBacklog: 0,
  fixesInFlight: 0,
  fixesFailed: 0,
  prsOpen: 0,
  regressedActions: 0,
  inboxOpenActions: 0,
  notificationsUnread: 0,
  queueFailed: 0,
  healthIssues: 0,
  flaggedDevices: 0,
  feedbackWithReply: 0,
  judgeDisagreements: 0,
  projectCount: 0,
  projectsNeedingAttention: 0,
  neverIngestedCount: 0,
  staleKeyCount: 0,
  memberCount: null,
  pendingInvites: 0,
  membersInactiveCount: 0,
  membersAtSeatCap: false,
  membersExpiringInvites: 0,
  superAdminSignups7d: null,
  superAdminChurn30d: null,
  slices: EMPTY_NAV_STAT_SLICES,
  ready: true,
}

const NO_EXTRAS = { criticalReports30d: 0 }

describe('rail a11y contract', () => {
  it('puts the name on aria-label and the explanation in a resolvable describedby target', () => {
    const html = renderRail()
    const descId = railDescriptionId('/reports')

    expect(html).toContain('aria-label="Reports"')
    expect(html).toContain(`aria-describedby="${descId}"`)
    // The referenced element must actually exist in the same markup.
    expect(html).toContain(`id="${descId}"`)
    expect(html).toContain('Triage inbound bug reports')
  })

  it('does not rely on the flyout for the description (tooltip is closed at rest)', () => {
    const html = renderRail()
    // Tooltip only mounts its content on hover/focus, so nothing with
    // role=tooltip is present — yet the description is still in the DOM.
    expect(html).not.toContain('role="tooltip"')
    expect(html).toContain('sr-only')
    expect(html).toContain('Triage inbound bug reports')
  })

  it('marks the current route with aria-current', () => {
    expect(renderRail({ active: true })).toContain('aria-current="page"')
    expect(renderRail({ active: false })).not.toContain('aria-current')
  })

  it('folds live count prose into the described-by text, not just the badge colour', () => {
    const html = renderRail({
      badge: {
        kind: 'health',
        tone: 'danger',
        count: 3,
        label: '3 critical reports (30d)',
        hideWhenZero: true,
      },
    })
    expect(html).toContain('3 critical reports (30d)')
    // The visual pill itself is decorative — the prose above carries it.
    expect(html).toContain('aria-hidden="true"')
  })
})

describe('rail badge rendering', () => {
  it('caps counts so a runaway number cannot widen the 44px tile', () => {
    expect(railBadgeText(3)).toBe('3')
    expect(railBadgeText(99)).toBe('99')
    expect(railBadgeText(100)).toBe('99+')
    expect(railBadgeText(12_345)).toBe('99+')
  })

  it('renders a numeric pill when there is a count', () => {
    const html = renderRail({
      badge: { kind: 'count', count: 12, label: '12 inventory nodes' },
    })
    expect(html).toContain('nav-rail-badge')
    expect(html).not.toContain('nav-rail-badge--dot')
    expect(html).toContain('>12<')
  })

  it('applies the 99+ cap through the component, not just the helper', () => {
    const html = renderRail({
      badge: {
        kind: 'health',
        tone: 'danger',
        count: 240,
        label: '240 untriaged reports',
        hideWhenZero: true,
      },
    })
    expect(html).toContain('>99+<')
    expect(html).not.toContain('>240<')
    // The uncapped number still reaches assistive tech via the description.
    expect(html).toContain('240 untriaged reports')
  })

  it('renders the dot variant when the status has no number', () => {
    const html = renderRail({
      badge: {
        kind: 'budget',
        spendSpike24h: true,
        calls24h: 0,
        spend24hUsd: 4,
        label: 'LLM spend spike in last 24h',
      },
    })
    expect(html).toContain('nav-rail-badge--dot')
  })

  it('renders no badge element when nothing needs attention', () => {
    expect(renderRail({ badge: null })).not.toContain('nav-rail-badge')
  })

  it('gives the self-fetching integration dot its own positioned slot', () => {
    const html = renderRail({ to: '/integrations/config', badge: { kind: 'integration' } })
    expect(html).toContain('nav-rail-badge-slot')
  })
})

describe('railDescriptionId', () => {
  it('produces a stable, collision-free id from a path', () => {
    expect(railDescriptionId('/reports')).toBe('rail-desc-reports')
    expect(railDescriptionId('/organization/members')).toBe('rail-desc-organization-members')
    expect(railDescriptionId('/integrations/config')).toBe('rail-desc-integrations-config')
    // Query-bearing and root paths must still yield a valid id.
    expect(railDescriptionId('/skills?tab=catalog')).toBe('rail-desc-skills-tab-catalog')
    expect(railDescriptionId('/')).toBe('rail-desc-root')
  })
})

describe('NavRailFlyout', () => {
  it('renders title, description, live status, and hint', () => {
    const html = renderToStaticMarkup(
      <NavRailFlyout
        title="Reports"
        description="Triage inbound bug reports."
        status={{ tone: 'danger', label: '3 critical reports (30d)' }}
        kicker={{ label: 'P', className: 'chip' }}
        hint="Press [ to expand"
      />,
    )
    expect(html).toContain('Reports')
    expect(html).toContain('Triage inbound bug reports.')
    expect(html).toContain('3 critical reports (30d)')
    expect(html).toContain('Press [ to expand')
    expect(html).toContain('>P<')
  })

  it('gives the title a larger step than the body so hierarchy is real', () => {
    const html = renderToStaticMarkup(
      <NavRailFlyout title="Reports" description="Body copy." />,
    )
    expect(html).toContain('text-xs font-semibold')
    expect(html).toContain('text-2xs leading-relaxed')
  })

  it('omits optional rows entirely when not supplied', () => {
    const html = renderToStaticMarkup(<NavRailFlyout title="Reports" />)
    expect(html).not.toContain('border-t')
    expect(html).toContain('Reports')
  })

  it('stays inline-level — Tooltip renders content inside a <span role=tooltip>', () => {
    const html = renderToStaticMarkup(
      <NavRailFlyout title="Reports" description="Body." status={{ tone: 'ok', label: 'All clear' }} />,
    )
    expect(html).not.toMatch(/<(div|p|h[1-6])[\s>]/)
  })
})

describe('navBadgeStatus', () => {
  it('hides a zero health count when hideWhenZero is set', () => {
    const spec: NavBadgeSpec = {
      kind: 'health',
      tone: 'ok',
      count: 0,
      label: 'All integrations healthy',
      hideWhenZero: true,
    }
    expect(navBadgeStatus(spec)).toBeNull()
  })

  it('keeps a zero health count as a status-only dot when hideWhenZero is not set', () => {
    const spec: NavBadgeSpec = { kind: 'health', tone: 'ok', count: 0, label: 'Healthy' }
    expect(navBadgeStatus(spec)).toEqual({ tone: 'ok', count: null, label: 'Healthy' })
  })

  it('drops a zero inventory count', () => {
    expect(navBadgeStatus({ kind: 'count', count: 0, label: 'none' })).toBeNull()
  })

  it('reports a spend spike as warn with no number', () => {
    const spec: NavBadgeSpec = {
      kind: 'budget',
      spendSpike24h: true,
      calls24h: 500,
      spend24hUsd: 9,
      label: 'LLM spend spike in last 24h',
    }
    expect(navBadgeStatus(spec)).toEqual({
      tone: 'warn',
      count: null,
      label: 'LLM spend spike in last 24h',
    })
  })

  it('defers to the self-fetching component for integration health', () => {
    expect(navBadgeStatus({ kind: 'integration' })).toBeNull()
    expect(navBadgeStatus(null)).toBeNull()
  })
})

describe('resolveNavBadge', () => {
  it('returns nothing before counts are ready', () => {
    const notReady = { ...NAV_COUNTS_ZERO, ready: false }
    expect(resolveNavBadge('/reports', notReady, NO_EXTRAS)).toBeNull()
  })

  it('prefers critical reports over raw backlog on /reports', () => {
    const counts = { ...NAV_COUNTS_ZERO, untriagedBacklog: 8 }
    expect(resolveNavBadge('/reports', counts, { criticalReports30d: 2 })).toMatchObject({
      kind: 'health',
      tone: 'danger',
      count: 2,
      label: '2 critical reports (30d)',
    })
    expect(resolveNavBadge('/reports', counts, NO_EXTRAS)).toMatchObject({
      count: 8,
      label: '8 untriaged reports',
    })
  })

  it('falls back to the regression dot on /inventory and /graph only when the slice badge is absent', () => {
    const counts = { ...NAV_COUNTS_ZERO, regressedActions: 4 }
    // EMPTY_NAV_STAT_SLICES has no inventory/graph slice, so the fallback runs.
    expect(resolveNavBadge('/inventory', counts, NO_EXTRAS)).toMatchObject({
      kind: 'health',
      tone: 'danger',
      count: 4,
    })
    expect(resolveNavBadge('/graph', counts, NO_EXTRAS)).toMatchObject({
      kind: 'health',
      tone: 'danger',
      count: 4,
    })
  })

  it('surfaces failed fixes ahead of in-flight fixes on /fixes', () => {
    const counts = { ...NAV_COUNTS_ZERO, fixesFailed: 2, fixesInFlight: 5 }
    expect(resolveNavBadge('/fixes', counts, NO_EXTRAS)).toMatchObject({
      kind: 'health',
      count: 2,
      label: '2 failed fixes — needs attention',
    })
  })

  it('returns the self-fetching integration badge for the integrations route', () => {
    expect(resolveNavBadge('/integrations/config', NAV_COUNTS_ZERO, NO_EXTRAS)).toEqual({
      kind: 'integration',
    })
  })

  it('returns nothing for a route with no badge mapping', () => {
    expect(resolveNavBadge('/not-a-real-route', NAV_COUNTS_ZERO, NO_EXTRAS)).toBeNull()
  })
})
