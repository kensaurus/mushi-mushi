/**
 * FILE: apps/admin/src/lib/navBadges.tsx
 * PURPOSE: Central map from sidebar nav paths to count/health badges.
 *          Keeps Layout.tsx free of per-route imperative blocks.
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
  type NavCounts,
} from './useNavCounts'

export interface NavBadgeExtras {
  criticalReports30d: number
}

function renderSliceBadge(
  badge: WorkspaceNavBadge | null,
  inventoryFallback = 0,
): ReactNode {
  if (!badge) return null
  return (
    <SidebarNavCount
      count={badge.mode === 'inventory' ? badge.count : inventoryFallback}
      label={badge.label}
      attention={
        badge.mode === 'attention'
          ? {
              tone: badge.tone ?? 'warn',
              count: badge.count,
              label: badge.label,
            }
          : null
      }
    />
  )
}

export function renderNavBadge(
  path: string,
  navCounts: NavCounts,
  extras: NavBadgeExtras,
): ReactNode {
  if (!navCounts.ready) return null

  const { slices } = navCounts

  switch (path) {
    case '/onboarding':
    case '/connect':
      return renderSliceBadge(onboardingNavBadge(slices.onboarding))
    case '/dashboard':
      return renderSliceBadge(dashboardNavBadge(slices.dashboard))
    case '/content':
      return renderSliceBadge(
        contentQualityNavBadge(slices.contentQuality),
        slices.contentQuality?.needsAttentionCount ?? 0,
      )
    case '/projects': {
      const badge = projectsNavBadge({
        projectCount: navCounts.projectCount,
        neverIngestedCount: navCounts.neverIngestedCount,
        staleKeyCount: navCounts.staleKeyCount,
      })
      return renderSliceBadge(badge, navCounts.projectCount)
    }
    case '/organization/members': {
      if (navCounts.memberCount == null && navCounts.pendingInvites === 0) return null
      const badge = membersNavBadge({
        memberCount: navCounts.memberCount ?? 0,
        pendingInvites: navCounts.pendingInvites,
      })
      return renderSliceBadge(badge, navCounts.memberCount ?? 0)
    }
    case '/feature-board':
      return renderSliceBadge(
        featureBoardNavBadge(slices.featureBoard),
        slices.featureBoard?.openCount ?? 0,
      )
    case '/rewards':
      return renderSliceBadge(
        rewardsNavBadge(slices.rewards),
        slices.rewards?.activeContributors30d ?? 0,
      )
    case '/billing':
      return renderSliceBadge(billingNavBadge(slices.billing))
    case '/audit':
      return renderSliceBadge(auditNavBadge(slices.audit), slices.audit?.events24h ?? 0)
    case '/fullstack-audit':
      return renderSliceBadge(fullstackAuditNavBadge(slices.fullstackAudit))
    case '/code-health':
      return renderSliceBadge(codeHealthNavBadge(slices.codeHealth))
    case '/qa-coverage':
      return renderSliceBadge(
        qaCoverageNavBadge(slices.qaCoverage),
        slices.qaCoverage?.totalStories ?? 0,
      )
    case '/lessons':
      return renderSliceBadge(
        lessonsNavBadge(slices.lessons),
        slices.lessons?.activeLessons ?? 0,
      )
    case '/drift':
      return renderSliceBadge(driftNavBadge(slices.drift))
    case '/releases':
      return renderSliceBadge(
        releasesNavBadge(slices.releases),
        slices.releases?.totalReleases ?? 0,
      )
    case '/intelligence':
      return renderSliceBadge(
        intelligenceNavBadge(slices.intelligence),
        slices.intelligence?.reportCount ?? 0,
      )
    case '/explore':
      return renderSliceBadge(
        exploreNavBadge(slices.explore),
        slices.explore?.indexedFiles ?? 0,
      )
    case '/experiments':
      return renderSliceBadge(
        experimentsNavBadge(slices.experiments),
        slices.experiments?.totalExperiments ?? 0,
      )
    case '/anomalies':
      return renderSliceBadge(anomaliesNavBadge(slices.anomalies))
    case '/iterate':
      return renderSliceBadge(iterateNavBadge(slices.iterate), slices.iterate?.total ?? 0)
    case '/research':
      return renderSliceBadge(
        researchNavBadge(slices.research),
        slices.research?.sessions ?? 0,
      )
    case '/prompt-lab':
      return renderSliceBadge(
        promptLabNavBadge(slices.promptLab),
        slices.promptLab?.totalPrompts ?? 0,
      )
    case '/inventory':
      return (
        renderSliceBadge(inventoryNavBadge(slices.inventory)) ?? (
          <SidebarHealthDot
            tone={navCounts.regressedActions > 0 ? 'danger' : 'ok'}
            count={navCounts.regressedActions}
            label={
              navCounts.regressedActions > 0
                ? `${navCounts.regressedActions} regressed inventory actions`
                : 'No regressed inventory actions'
            }
            hideWhenZero
          />
        )
      )
    case '/graph':
      return (
        renderSliceBadge(graphNavBadge(slices.graph)) ?? (
          <SidebarHealthDot
            tone={navCounts.regressedActions > 0 ? 'danger' : 'ok'}
            count={navCounts.regressedActions}
            label={
              navCounts.regressedActions > 0
                ? `${navCounts.regressedActions} regressed actions in the graph`
                : 'Graph healthy — no regressions'
            }
            hideWhenZero
          />
        )
      )
    case '/fixes': {
      const sliceBadge = fixesStatsNavBadge(slices.fixes)
      if (sliceBadge) return renderSliceBadge(sliceBadge)
      return (
        <SidebarHealthDot
          tone={
            navCounts.fixesFailed > 0
              ? toneForFailed(navCounts.fixesFailed)
              : toneForInFlight(navCounts.fixesInFlight)
          }
          count={
            navCounts.fixesFailed > 0 ? navCounts.fixesFailed : navCounts.fixesInFlight
          }
          label={
            navCounts.fixesFailed > 0
              ? `${navCounts.fixesFailed} failed fixes — needs attention`
              : navCounts.fixesInFlight > 0
                ? `${navCounts.fixesInFlight} fixes in flight`
                : 'No active fixes'
          }
          hideWhenZero
        />
      )
    }
    case '/repo': {
      const sliceBadge = repoStatsNavBadge(slices.repo)
      if (sliceBadge) return renderSliceBadge(sliceBadge)
      if (navCounts.prsOpen <= 0) return null
      return (
        <SidebarHealthDot
          tone="ok"
          count={navCounts.prsOpen}
          label={`${navCounts.prsOpen} PRs open awaiting review`}
        />
      )
    }
    case '/health': {
      const sliceBadge = healthStatsNavBadge(slices.health)
      if (sliceBadge) return renderSliceBadge(sliceBadge)
      return (
        <SidebarHealthDot
          tone={toneForFailed(navCounts.healthIssues)}
          count={navCounts.healthIssues}
          label={
            navCounts.healthIssues > 0
              ? `${navCounts.healthIssues} integration${navCounts.healthIssues === 1 ? '' : 's'} reporting issues`
              : 'All integrations healthy'
          }
          hideWhenZero
        />
      )
    }
    case '/skills':
      return renderSliceBadge(
        skillsNavBadge(slices.skills),
        slices.skills?.catalogTotal ?? 0,
      )
    case '/integrations/config': {
      const sliceBadge = integrationsNavBadge(slices.integrations)
      if (sliceBadge) return renderSliceBadge(sliceBadge)
      return <IntegrationHealthDot />
    }
    case '/mcp':
      return renderSliceBadge(mcpNavBadge(slices.mcp))
    case '/marketplace':
      return renderSliceBadge(
        marketplaceNavBadge(slices.marketplace),
        slices.marketplace?.installedActive ?? 0,
      )
    case '/settings':
      return renderSliceBadge(settingsNavBadge(slices.settings))
    case '/cost': {
      const costs = slices.costs
      const badge = costsNavBadge(costs)
      if (costs?.spendSpike24h) {
        return (
          <SidebarBudgetIndicator
            spendSpike24h
            calls24h={costs.calls24h}
            spend24hUsd={costs.spend24hUsd}
            label={badge?.label ?? 'LLM spend spike in last 24h'}
          />
        )
      }
      return renderSliceBadge(badge, costs?.calls24h ?? 0)
    }
    case '/sso':
      return renderSliceBadge(ssoNavBadge(slices.sso))
    case '/compliance':
      return renderSliceBadge(complianceNavBadge(slices.compliance))
    case '/storage':
      return renderSliceBadge(storageNavBadge(slices.storage))
    case '/query':
      return renderSliceBadge(
        queryNavBadge(slices.query),
        slices.query?.savedCount ?? slices.query?.runs24h ?? 0,
      )
    case '/users':
      return renderSliceBadge(
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
      return (
        <SidebarHealthDot
          tone={toneForFailed(navCounts.flaggedDevices)}
          count={navCounts.flaggedDevices}
          label={
            navCounts.flaggedDevices > 0
              ? `${navCounts.flaggedDevices} flagged ${navCounts.flaggedDevices === 1 ? 'device' : 'devices'} — review for abuse`
              : 'No flagged devices'
          }
          hideWhenZero
        />
      )
    case '/reports':
      return (
        <SidebarHealthDot
          tone={
            extras.criticalReports30d > 0
              ? 'danger'
              : toneForBacklog(navCounts.untriagedBacklog)
          }
          count={
            extras.criticalReports30d > 0
              ? extras.criticalReports30d
              : navCounts.untriagedBacklog
          }
          label={
            extras.criticalReports30d > 0
              ? `${extras.criticalReports30d} critical ${extras.criticalReports30d === 1 ? 'report' : 'reports'} (30d)`
              : `${navCounts.untriagedBacklog} untriaged ${navCounts.untriagedBacklog === 1 ? 'report' : 'reports'}`
          }
          hideWhenZero
        />
      )
    case '/judge':
      return (
        <SidebarHealthDot
          tone={toneForFailed(navCounts.judgeDisagreements)}
          count={navCounts.judgeDisagreements}
          label={
            navCounts.judgeDisagreements > 0
              ? `${navCounts.judgeDisagreements} classifier vs judge ${navCounts.judgeDisagreements === 1 ? 'disagreement' : 'disagreements'}`
              : 'Judge agrees with classifier'
          }
          hideWhenZero
        />
      )
    case '/feedback':
      return (
        <SidebarHealthDot
          tone={navCounts.feedbackWithReply > 0 ? 'warn' : 'idle'}
          count={navCounts.feedbackWithReply}
          label={
            navCounts.feedbackWithReply > 0
              ? `${navCounts.feedbackWithReply} feedback ${navCounts.feedbackWithReply === 1 ? 'reply' : 'replies'} to read`
              : 'No new feedback replies'
          }
          hideWhenZero
        />
      )
    case '/inbox':
      return (
        <SidebarHealthDot
          tone={toneForOpen(navCounts.inboxOpenActions, 6)}
          count={navCounts.inboxOpenActions}
          label={
            navCounts.inboxOpenActions > 0
              ? `${navCounts.inboxOpenActions} open action${navCounts.inboxOpenActions === 1 ? '' : 's'} in Action Inbox`
              : 'Action Inbox — all clear'
          }
          hideWhenZero
        />
      )
    case '/notifications':
      return (
        <SidebarHealthDot
          tone={toneForOpen(navCounts.notificationsUnread, 11)}
          count={navCounts.notificationsUnread}
          label={
            navCounts.notificationsUnread > 0
              ? `${navCounts.notificationsUnread} unread notification${navCounts.notificationsUnread === 1 ? '' : 's'}`
              : 'All notifications read'
          }
          hideWhenZero
        />
      )
    case '/queue':
      return (
        <SidebarHealthDot
          tone={toneForFailed(navCounts.queueFailed)}
          count={navCounts.queueFailed}
          label={
            navCounts.queueFailed > 0
              ? `${navCounts.queueFailed} dead-letter / failed queue ${navCounts.queueFailed === 1 ? 'item' : 'items'}`
              : 'Queue clear — no stuck items'
          }
          hideWhenZero
        />
      )
    default:
      return null
  }
}
