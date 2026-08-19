/**
 * FILE: apps/admin/src/lib/navBadges.tsx
 * PURPOSE: Central map from sidebar nav paths to count/health badges.
 *          Keeps Layout.tsx free of per-route imperative blocks.
 *
 * `resolveNavBadge` returns the badge *data*; `renderNavBadge` renders it for
 * the expanded sidebar. The collapsed icon rail needs the same numbers in a
 * different shape (an overlay pill on the glyph plus a prose line inside the
 * hover flyout), so it reads the spec directly via `navBadgeStatus` instead of
 * re-deriving counts — one switch, two presentations.
 */

import type { ReactNode } from 'react'
import { IntegrationHealthDot } from '../components/IntegrationHealthDot'
import { SidebarBudgetIndicator } from '../components/SidebarBudgetIndicator'
import { SidebarHealthDot } from '../components/SidebarHealthDot'
import { SidebarNavCount } from '../components/SidebarNavCount'
import {
  anomaliesNavBadge,
  auditNavBadge,
  billingNavBadge,
  codeHealthNavBadge,
  complianceNavBadge,
  contentQualityNavBadge,
  costsNavBadge,
  dashboardNavBadge,
  driftNavBadge,
  experimentsNavBadge,
  exploreNavBadge,
  featureBoardNavBadge,
  fixesStatsNavBadge,
  fullstackAuditNavBadge,
  graphNavBadge,
  healthStatsNavBadge,
  integrationsNavBadge,
  intelligenceNavBadge,
  inventoryNavBadge,
  iterateNavBadge,
  lessonsNavBadge,
  marketplaceNavBadge,
  mcpNavBadge,
  onboardingNavBadge,
  promptLabNavBadge,
  qaCoverageNavBadge,
  queryNavBadge,
  releasesNavBadge,
  repoStatsNavBadge,
  researchNavBadge,
  rewardsNavBadge,
  settingsNavBadge,
  skillsNavBadge,
  ssoNavBadge,
  storageNavBadge,
  usersNavBadge,
} from './extendedNavMeta'
import {
  membersNavBadge,
  projectsNavBadge,
  type WorkspaceNavBadge,
} from './workspaceNavMeta'
import {
  toneForBacklog,
  toneForFailed,
  toneForInFlight,
  toneForOpen,
  type HealthTone,
  type NavCounts,
} from './useNavCounts'

export interface NavBadgeExtras {
  criticalReports30d: number
}

/**
 * What a nav path wants to say about itself right now.
 * - `count`    neutral inventory number (no tone, no dot)
 * - `health`   tone + optional count — something may need attention
 * - `budget`   /cost spend bar (spike) or call-count inventory
 * - `integration` self-fetching integration health dot (owns its own state)
 */
export type NavBadgeSpec =
  | { kind: 'count'; count: number; label: string }
  | {
      kind: 'health'
      tone: HealthTone
      count: number
      label: string
      hideWhenZero?: boolean
    }
  | {
      kind: 'budget'
      spendSpike24h: boolean
      calls24h: number
      spend24hUsd: number
      label: string
    }
  | { kind: 'integration' }

/**
 * Collapse a slice badge into a spec, mirroring SidebarNavCount's own
 * precedence: an attention badge with a real count wins, otherwise the
 * inventory number renders neutral, otherwise nothing.
 */
function sliceBadgeSpec(
  badge: WorkspaceNavBadge | null,
  inventoryFallback = 0,
): NavBadgeSpec | null {
  if (!badge) return null
  if (badge.mode === 'attention' && badge.count > 0) {
    return {
      kind: 'health',
      tone: badge.tone ?? 'warn',
      count: badge.count,
      label: badge.label,
      hideWhenZero: true,
    }
  }
  const count = badge.mode === 'inventory' ? badge.count : inventoryFallback
  if (count <= 0) return null
  return { kind: 'count', count, label: badge.label }
}

export function resolveNavBadge(
  path: string,
  navCounts: NavCounts,
  extras: NavBadgeExtras,
): NavBadgeSpec | null {
  if (!navCounts.ready) return null

  const { slices } = navCounts

  switch (path) {
    case '/onboarding':
    case '/connect':
      return sliceBadgeSpec(onboardingNavBadge(slices.onboarding))
    case '/dashboard':
      return sliceBadgeSpec(dashboardNavBadge(slices.dashboard))
    case '/content':
      return sliceBadgeSpec(
        contentQualityNavBadge(slices.contentQuality),
        slices.contentQuality?.needsAttentionCount ?? 0,
      )
    case '/projects': {
      const badge = projectsNavBadge({
        projectCount: navCounts.projectCount,
        neverIngestedCount: navCounts.neverIngestedCount,
        staleKeyCount: navCounts.staleKeyCount,
      })
      return sliceBadgeSpec(badge, navCounts.projectCount)
    }
    case '/organization/members': {
      if (navCounts.memberCount == null && navCounts.pendingInvites === 0) return null
      const badge = membersNavBadge({
        memberCount: navCounts.memberCount ?? 0,
        pendingInvites: navCounts.pendingInvites,
      })
      return sliceBadgeSpec(badge, navCounts.memberCount ?? 0)
    }
    case '/feature-board':
      return sliceBadgeSpec(
        featureBoardNavBadge(slices.featureBoard),
        slices.featureBoard?.openCount ?? 0,
      )
    case '/rewards':
      return sliceBadgeSpec(
        rewardsNavBadge(slices.rewards),
        slices.rewards?.activeContributors30d ?? 0,
      )
    case '/billing':
      return sliceBadgeSpec(billingNavBadge(slices.billing))
    case '/audit':
      return sliceBadgeSpec(auditNavBadge(slices.audit), slices.audit?.events24h ?? 0)
    case '/fullstack-audit':
      return sliceBadgeSpec(fullstackAuditNavBadge(slices.fullstackAudit))
    case '/code-health':
      return sliceBadgeSpec(codeHealthNavBadge(slices.codeHealth))
    case '/qa-coverage':
      return sliceBadgeSpec(
        qaCoverageNavBadge(slices.qaCoverage),
        slices.qaCoverage?.totalStories ?? 0,
      )
    case '/lessons':
      return sliceBadgeSpec(
        lessonsNavBadge(slices.lessons),
        slices.lessons?.activeLessons ?? 0,
      )
    case '/drift':
      return sliceBadgeSpec(driftNavBadge(slices.drift))
    case '/releases':
      return sliceBadgeSpec(
        releasesNavBadge(slices.releases),
        slices.releases?.totalReleases ?? 0,
      )
    case '/intelligence':
      return sliceBadgeSpec(
        intelligenceNavBadge(slices.intelligence),
        slices.intelligence?.reportCount ?? 0,
      )
    case '/explore':
      return sliceBadgeSpec(
        exploreNavBadge(slices.explore),
        slices.explore?.indexedFiles ?? 0,
      )
    case '/experiments':
      return sliceBadgeSpec(
        experimentsNavBadge(slices.experiments),
        slices.experiments?.totalExperiments ?? 0,
      )
    case '/anomalies':
      return sliceBadgeSpec(anomaliesNavBadge(slices.anomalies))
    case '/iterate':
      return sliceBadgeSpec(iterateNavBadge(slices.iterate), slices.iterate?.total ?? 0)
    case '/research':
      return sliceBadgeSpec(
        researchNavBadge(slices.research),
        slices.research?.sessions ?? 0,
      )
    case '/prompt-lab':
      return sliceBadgeSpec(
        promptLabNavBadge(slices.promptLab),
        slices.promptLab?.totalPrompts ?? 0,
      )
    // The fallback gate checks the BADGE, not the spec. `sliceBadgeSpec` also
    // returns null for a zero count, so `?? fallback` would let a zero-count
    // slice badge fall through to the regression dot — which the pre-refactor
    // code never did (it only fell through when the badge itself was absent).
    // Both nav-badge builders currently guard every branch with `> 0`, so that
    // divergence is unreachable today; gating on the badge keeps it that way if
    // one ever gains a zero-count branch.
    case '/inventory': {
      const badge = inventoryNavBadge(slices.inventory)
      if (badge) return sliceBadgeSpec(badge)
      return {
        kind: 'health',
        tone: navCounts.regressedActions > 0 ? 'danger' : 'ok',
        count: navCounts.regressedActions,
        label:
          navCounts.regressedActions > 0
            ? `${navCounts.regressedActions} regressed inventory actions`
            : 'No regressed inventory actions',
        hideWhenZero: true,
      }
    }
    case '/graph': {
      const badge = graphNavBadge(slices.graph)
      if (badge) return sliceBadgeSpec(badge)
      return {
        kind: 'health',
        tone: navCounts.regressedActions > 0 ? 'danger' : 'ok',
        count: navCounts.regressedActions,
        label:
          navCounts.regressedActions > 0
            ? `${navCounts.regressedActions} regressed actions in the graph`
            : 'Graph healthy — no regressions',
        hideWhenZero: true,
      }
    }
    case '/fixes': {
      const sliceBadge = fixesStatsNavBadge(slices.fixes)
      if (sliceBadge) return sliceBadgeSpec(sliceBadge)
      return {
        kind: 'health',
        tone:
          navCounts.fixesFailed > 0
            ? toneForFailed(navCounts.fixesFailed)
            : toneForInFlight(navCounts.fixesInFlight),
        count:
          navCounts.fixesFailed > 0 ? navCounts.fixesFailed : navCounts.fixesInFlight,
        label:
          navCounts.fixesFailed > 0
            ? `${navCounts.fixesFailed} failed fixes — needs attention`
            : navCounts.fixesInFlight > 0
              ? `${navCounts.fixesInFlight} fixes in flight`
              : 'No active fixes',
        hideWhenZero: true,
      }
    }
    case '/repo': {
      const sliceBadge = repoStatsNavBadge(slices.repo)
      if (sliceBadge) return sliceBadgeSpec(sliceBadge)
      if (navCounts.prsOpen <= 0) return null
      return {
        kind: 'health',
        tone: 'ok',
        count: navCounts.prsOpen,
        label: `${navCounts.prsOpen} PRs open awaiting review`,
      }
    }
    case '/health': {
      const sliceBadge = healthStatsNavBadge(slices.health)
      if (sliceBadge) return sliceBadgeSpec(sliceBadge)
      return {
        kind: 'health',
        tone: toneForFailed(navCounts.healthIssues),
        count: navCounts.healthIssues,
        label:
          navCounts.healthIssues > 0
            ? `${navCounts.healthIssues} integration${navCounts.healthIssues === 1 ? '' : 's'} reporting issues`
            : 'All integrations healthy',
        hideWhenZero: true,
      }
    }
    case '/skills':
      return sliceBadgeSpec(skillsNavBadge(slices.skills), slices.skills?.catalogTotal ?? 0)
    case '/integrations/config': {
      const sliceBadge = integrationsNavBadge(slices.integrations)
      if (sliceBadge) return sliceBadgeSpec(sliceBadge)
      return { kind: 'integration' }
    }
    case '/mcp':
      return sliceBadgeSpec(mcpNavBadge(slices.mcp))
    case '/marketplace':
      return sliceBadgeSpec(
        marketplaceNavBadge(slices.marketplace),
        slices.marketplace?.installedActive ?? 0,
      )
    case '/settings':
      return sliceBadgeSpec(settingsNavBadge(slices.settings))
    case '/cost': {
      const costs = slices.costs
      const badge = costsNavBadge(costs)
      if (costs?.spendSpike24h) {
        return {
          kind: 'budget',
          spendSpike24h: true,
          calls24h: costs.calls24h,
          spend24hUsd: costs.spend24hUsd,
          label: badge?.label ?? 'LLM spend spike in last 24h',
        }
      }
      return sliceBadgeSpec(badge, costs?.calls24h ?? 0)
    }
    case '/sso':
      return sliceBadgeSpec(ssoNavBadge(slices.sso))
    case '/compliance':
      return sliceBadgeSpec(complianceNavBadge(slices.compliance))
    case '/storage':
      return sliceBadgeSpec(storageNavBadge(slices.storage))
    case '/query':
      return sliceBadgeSpec(
        queryNavBadge(slices.query),
        slices.query?.savedCount ?? slices.query?.runs24h ?? 0,
      )
    case '/users':
      return sliceBadgeSpec(
        usersNavBadge(
          navCounts.superAdminSignups7d != null || navCounts.superAdminChurn30d != null
            ? {
                signups7d: navCounts.superAdminSignups7d ?? 0,
                churn30d: navCounts.superAdminChurn30d ?? 0,
              }
            : null,
        ),
        navCounts.superAdminSignups7d ?? 0,
      )
    case '/anti-gaming':
      return {
        kind: 'health',
        tone: toneForFailed(navCounts.flaggedDevices),
        count: navCounts.flaggedDevices,
        label:
          navCounts.flaggedDevices > 0
            ? `${navCounts.flaggedDevices} flagged ${navCounts.flaggedDevices === 1 ? 'device' : 'devices'} — review for abuse`
            : 'No flagged devices',
        hideWhenZero: true,
      }
    case '/reports':
      return {
        kind: 'health',
        tone:
          extras.criticalReports30d > 0
            ? 'danger'
            : toneForBacklog(navCounts.untriagedBacklog),
        count:
          extras.criticalReports30d > 0
            ? extras.criticalReports30d
            : navCounts.untriagedBacklog,
        label:
          extras.criticalReports30d > 0
            ? `${extras.criticalReports30d} critical ${extras.criticalReports30d === 1 ? 'report' : 'reports'} (30d)`
            : `${navCounts.untriagedBacklog} untriaged ${navCounts.untriagedBacklog === 1 ? 'report' : 'reports'}`,
        hideWhenZero: true,
      }
    case '/judge':
      return {
        kind: 'health',
        tone: toneForFailed(navCounts.judgeDisagreements),
        count: navCounts.judgeDisagreements,
        label:
          navCounts.judgeDisagreements > 0
            ? `${navCounts.judgeDisagreements} classifier vs judge ${navCounts.judgeDisagreements === 1 ? 'disagreement' : 'disagreements'}`
            : 'Judge agrees with classifier',
        hideWhenZero: true,
      }
    case '/feedback':
      return {
        kind: 'health',
        tone: navCounts.feedbackWithReply > 0 ? 'warn' : 'idle',
        count: navCounts.feedbackWithReply,
        label:
          navCounts.feedbackWithReply > 0
            ? `${navCounts.feedbackWithReply} feedback ${navCounts.feedbackWithReply === 1 ? 'reply' : 'replies'} to read`
            : 'No new feedback replies',
        hideWhenZero: true,
      }
    case '/inbox':
      return {
        kind: 'health',
        tone: toneForOpen(navCounts.inboxOpenActions, 6),
        count: navCounts.inboxOpenActions,
        label:
          navCounts.inboxOpenActions > 0
            ? `${navCounts.inboxOpenActions} open action${navCounts.inboxOpenActions === 1 ? '' : 's'} in Action Inbox`
            : 'Action Inbox — all clear',
        hideWhenZero: true,
      }
    case '/notifications':
      return {
        kind: 'health',
        tone: toneForOpen(navCounts.notificationsUnread, 11),
        count: navCounts.notificationsUnread,
        label:
          navCounts.notificationsUnread > 0
            ? `${navCounts.notificationsUnread} unread notification${navCounts.notificationsUnread === 1 ? '' : 's'}`
            : 'All notifications read',
        hideWhenZero: true,
      }
    case '/queue':
      return {
        kind: 'health',
        tone: toneForFailed(navCounts.queueFailed),
        count: navCounts.queueFailed,
        label:
          navCounts.queueFailed > 0
            ? `${navCounts.queueFailed} dead-letter / failed queue ${navCounts.queueFailed === 1 ? 'item' : 'items'}`
            : 'Queue clear — no stuck items',
        hideWhenZero: true,
      }
    default:
      return null
  }
}

/** Expanded sidebar + mobile drawer badge — inline, right-aligned. */
export function renderNavBadge(
  path: string,
  navCounts: NavCounts,
  extras: NavBadgeExtras,
): ReactNode {
  const spec = resolveNavBadge(path, navCounts, extras)
  if (!spec) return null
  switch (spec.kind) {
    case 'count':
      return <SidebarNavCount count={spec.count} label={spec.label} />
    case 'health':
      return (
        <SidebarHealthDot
          tone={spec.tone}
          count={spec.count}
          label={spec.label}
          hideWhenZero={spec.hideWhenZero}
        />
      )
    case 'budget':
      return (
        <SidebarBudgetIndicator
          spendSpike24h={spec.spendSpike24h}
          calls24h={spec.calls24h}
          spend24hUsd={spec.spend24hUsd}
          label={spec.label}
        />
      )
    case 'integration':
      return <IntegrationHealthDot />
  }
}

/**
 * Flattened view for the collapsed rail: what the overlay pill should show and
 * what prose the hover flyout should print underneath the description.
 * `count: null` means "status only, no number" (a bare tone dot).
 * Returns null when the path has nothing worth interrupting the rail for.
 */
export interface NavBadgeStatus {
  tone: HealthTone
  count: number | null
  label: string
}

export function navBadgeStatus(spec: NavBadgeSpec | null): NavBadgeStatus | null {
  if (!spec) return null
  switch (spec.kind) {
    case 'count':
      return spec.count > 0 ? { tone: 'idle', count: spec.count, label: spec.label } : null
    case 'health': {
      if (spec.hideWhenZero && spec.count <= 0) return null
      return {
        tone: spec.tone,
        count: spec.count > 0 ? spec.count : null,
        label: spec.label,
      }
    }
    case 'budget':
      if (spec.spendSpike24h) return { tone: 'warn', count: null, label: spec.label }
      return spec.calls24h > 0
        ? { tone: 'idle', count: spec.calls24h, label: spec.label }
        : null
    case 'integration':
      // Self-fetching component owns its own tone/label; the rail renders the
      // dot itself rather than a derived pill.
      return null
  }
}
