/**
 * FILE: apps/admin/src/lib/useNextBestAction.ts
 * PURPOSE: Per-page Next-Best-Action computation — keyed by page scope +
 *          live counts the page already has in scope. Pages call this with
 *          a scope and a typed input shape; the hook returns `{ action }`
 *          that <PageActionBar> renders.
 *
 *          The rules live here so every Advanced PDCA page ends up with a
 *          consistent "do this next" strip sourced from real data rather
 *          than static copy.
 *
 *          Wave R (2026-04-22).
 */

import type { PageAction } from '../components/PageActionBar'

type Scope =
  | 'audit'
  | 'compliance'
  | 'intelligence'
  | 'judge'
  | 'health'
  | 'graph'
  | 'queue'
  | 'anti-gaming'
  | 'storage'
  | 'query'
  // Wave S (2026-04-23) — extended scopes so PageHero/PageActionBar drive
  // the same rule engine on every Advanced page, not just the first ten.
  | 'dlq'
  | 'prompt-lab'
  | 'repo'
  | 'mcp'
  | 'billing'
  | 'notifications'
  | 'marketplace'
  | 'integrations'
  | 'inventory'

type Input =
  | { scope: 'audit'; warnCount: number; failCount: number }
  | { scope: 'compliance'; openControls: number; nextReviewInDays: number | null }
  | { scope: 'intelligence'; lastDigestHoursAgo: number | null; topCategory: string | null; weekReports: number }
  | { scope: 'judge'; disagreementRate: number | null; sampledCount: number; staleHoursAgo: number | null }
  | { scope: 'health'; redCount: number; amberCount: number }
  | { scope: 'graph'; fragileComponents: number; untestedComponents: number }
  | { scope: 'queue'; stalledCount: number; runningCount: number }
  | { scope: 'anti-gaming'; flaggedLastHour: number; blockedIps: number }
  | { scope: 'storage'; approachingQuotaPct: number | null; failedUploadsLastHour: number }
  | { scope: 'query'; savedQueries: number; lastRunHoursAgo: number | null }
  | { scope: 'dlq'; pendingCount: number; poisonedCount: number; oldestPendingMinutes: number | null }
  | { scope: 'prompt-lab'; draftCount: number; untestedDrafts: number; lastRunHoursAgo: number | null }
  | { scope: 'repo'; reposWithoutIndex: number; staleIndexHoursAgo: number | null }
  | { scope: 'mcp'; unconfiguredClients: number; expiringKeysIn7Days: number }
  | { scope: 'billing'; pastDueInvoices: number; projectedOverrunPct: number | null }
  | { scope: 'notifications'; unreadCritical: number; totalUnread: number }
  | { scope: 'marketplace'; installableUpdates: number; disabledPlugins: number }
  | { scope: 'integrations'; disconnectedCount: number; expiringCount: number }
  | { scope: 'inventory'; fragileComponents: number; untestedComponents: number }

/**
 * Pure function — returns the action for a page scope given live input.
 * Extracted so pages can unit-test the rule order without mounting React.
 */
export function computeNextBestAction(input: Input): PageAction | null {
  switch (input.scope) {
    case 'audit':
      if (input.failCount > 0) {
        return {
          tone: 'do',
          title: `Remediate ${input.failCount} FAIL audit ${input.failCount === 1 ? 'control' : 'controls'}`,
          reason: 'These block the next SOC 2 cycle — open the remediation checklist.',
          primary: { kind: 'link', to: '/audit?status=fail', label: 'Open FAILs' },
          secondary: [{ kind: 'link', to: '/audit?export=csv', label: 'Export evidence' }],
        }
      }
      if (input.warnCount > 0) {
        return {
          tone: 'check',
          title: `${input.warnCount} WARN ${input.warnCount === 1 ? 'control needs' : 'controls need'} attention`,
          reason: 'WARNs don\u2019t block compliance but they\u2019re technical debt on evidence.',
          primary: { kind: 'link', to: '/audit?status=warn', label: 'Triage WARNs' },
          secondary: [{ kind: 'link', to: '/audit?export=csv', label: 'Export evidence' }],
        }
      }
      return null

    case 'compliance':
      if (input.openControls > 0) {
        return {
          tone: 'do',
          title: `Close ${input.openControls} open compliance ${input.openControls === 1 ? 'control' : 'controls'}`,
          reason: input.nextReviewInDays != null && input.nextReviewInDays <= 14
            ? `Next review in ${input.nextReviewInDays} days.`
            : 'Keep your compliance posture green.',
          primary: { kind: 'link', to: '/compliance?status=open', label: 'Open checklist' },
        }
      }
      return null

    case 'intelligence':
      if (input.lastDigestHoursAgo == null || input.lastDigestHoursAgo > 7 * 24) {
        return {
          tone: 'plan',
          title: 'Generate a fresh intelligence digest',
          reason: 'No digest in the last 7 days — trends drift without one.',
          primary: { kind: 'link', to: '/intelligence?action=generate', label: 'Generate now' },
        }
      }
      if (input.weekReports > 0 && input.topCategory) {
        return {
          tone: 'check',
          title: `Review the ${input.topCategory} spike (${input.weekReports} reports this week)`,
          reason: 'The intelligence digest flagged this category as trending.',
          primary: { kind: 'link', to: `/reports?category=${encodeURIComponent(input.topCategory)}`, label: 'Open filtered queue' },
        }
      }
      return null

    case 'judge':
      if (input.staleHoursAgo != null && input.staleHoursAgo > 48) {
        return {
          tone: 'plan',
          title: 'Trigger a fresh judge batch',
          reason: `Last evaluation ran ${Math.round(input.staleHoursAgo)}h ago — scores are going stale.`,
          primary: { kind: 'link', to: '/judge?action=run', label: 'Run judge batch' },
        }
      }
      if (input.disagreementRate != null && input.disagreementRate > 0.25) {
        return {
          tone: 'check',
          title: `Investigate ${(input.disagreementRate * 100).toFixed(0)}% judge disagreement`,
          reason: 'Disagreement above 25% usually means a prompt drift — open Prompt Lab.',
          primary: { kind: 'link', to: '/prompt-lab', label: 'Open Prompt Lab' },
          secondary: [{ kind: 'link', to: '/judge?filter=disagreement', label: 'Browse disagreements' }],
        }
      }
      return null

    case 'health':
      if (input.redCount > 0) {
        return {
          tone: 'do',
          title: `${input.redCount} ${input.redCount === 1 ? 'integration is' : 'integrations are'} failing`,
          reason: 'Red probes block the pipeline — fix auth keys or restart the affected service.',
          primary: { kind: 'link', to: '/health?status=red', label: 'Open failing probes' },
        }
      }
      if (input.amberCount > 0) {
        return {
          tone: 'check',
          title: `${input.amberCount} ${input.amberCount === 1 ? 'probe is' : 'probes are'} degraded`,
          reason: 'Amber probes are slow but not down — worth a look before they go red.',
          primary: { kind: 'link', to: '/health?status=amber', label: 'Review degraded' },
        }
      }
      return null

    case 'graph':
      if (input.fragileComponents > 0) {
        return {
          tone: 'do',
          title: `Batch-fix ${input.fragileComponents} fragile ${input.fragileComponents === 1 ? 'component' : 'components'}`,
          reason: 'Components with high bug density and low test coverage — classic technical debt.',
          primary: { kind: 'link', to: '/fixes?filter=fragile', label: 'Create fix batch' },
          secondary: [{ kind: 'link', to: '/graph?layer=components&filter=fragile', label: 'Inspect nodes' }],
        }
      }
      if (input.untestedComponents > 0) {
        return {
          tone: 'check',
          title: `${input.untestedComponents} ${input.untestedComponents === 1 ? 'component' : 'components'} have no test coverage`,
          reason: 'Adding even 1 regression test makes verification deterministic.',
          primary: { kind: 'link', to: '/graph?layer=components&filter=untested', label: 'Open untested nodes' },
        }
      }
      return null

    case 'inventory':
      if (input.fragileComponents > 0) {
        return {
          tone: 'do',
          title: `${input.fragileComponents} regressed ${input.fragileComponents === 1 ? 'action' : 'actions'} in inventory`,
          reason: 'Regressions flip when CI, synthetics, or volume signals disagree with verified claims.',
          primary: { kind: 'link', to: '/inventory', label: 'Open inventory' },
          secondary: [{ kind: 'link', to: '/inventory', label: 'Run gates' }],
        }
      }
      if (input.untestedComponents > 0) {
        return {
          tone: 'check',
          title: `${input.untestedComponents} action${input.untestedComponents === 1 ? '' : 's'} still unknown or unwired`,
          reason: 'Promote the riskiest flows from unknown → wired → verified with a ground-truth test.',
          primary: { kind: 'link', to: '/inventory', label: 'Review tree' },
        }
      }
      return null

    case 'queue':
      if (input.stalledCount > 0) {
        return {
          tone: 'do',
          title: `${input.stalledCount} stalled ${input.stalledCount === 1 ? 'job' : 'jobs'} in the queue`,
          reason: 'Jobs stuck > 10 min usually mean a dead worker — requeue or skip.',
          primary: { kind: 'link', to: '/queue?status=stalled', label: 'Open stalled jobs' },
        }
      }
      return null

    case 'anti-gaming':
      if (input.flaggedLastHour > 10) {
        return {
          tone: 'check',
          title: `${input.flaggedLastHour} suspicious reports in the last hour`,
          reason: 'A flood of flagged reports may be drift in the anti-gaming threshold.',
          primary: { kind: 'link', to: '/anti-gaming?window=1h', label: 'Review flagged' },
        }
      }
      return null

    case 'storage':
      if (input.approachingQuotaPct != null && input.approachingQuotaPct > 80) {
        return {
          tone: 'check',
          title: `Storage is ${input.approachingQuotaPct.toFixed(0)}% full`,
          reason: 'Purge old screenshots or raise the retention floor before new writes fail.',
          primary: { kind: 'link', to: '/storage?action=prune', label: 'Review retention' },
        }
      }
      if (input.failedUploadsLastHour > 0) {
        return {
          tone: 'do',
          title: `${input.failedUploadsLastHour} failed screenshot ${input.failedUploadsLastHour === 1 ? 'upload' : 'uploads'} in last hour`,
          primary: { kind: 'link', to: '/storage?filter=failed', label: 'Investigate' },
        }
      }
      return null

    case 'query':
      if (input.savedQueries === 0) {
        return {
          tone: 'plan',
          title: 'Save your first natural-language query',
          reason: 'Saved queries power the dashboard tiles and the NBA rules on other pages.',
          primary: { kind: 'link', to: '/query?action=new', label: 'New query' },
        }
      }
      return null

    case 'dlq':
      // Poisoned rows never retry — triage them first because they indicate
      // a classifier or schema bug, not a transient failure.
      if (input.poisonedCount > 0) {
        return {
          tone: 'do',
          title: `${input.poisonedCount} poisoned ${input.poisonedCount === 1 ? 'message' : 'messages'} in DLQ`,
          reason: 'Poisoned rows exceeded retry budget — inspect the payload and republish after fix.',
          primary: { kind: 'link', to: '/dlq?filter=poisoned', label: 'Open poisoned queue' },
          secondary: [{ kind: 'link', to: '/dlq?export=csv', label: 'Export for post-mortem' }],
        }
      }
      if (input.oldestPendingMinutes != null && input.oldestPendingMinutes > 30) {
        return {
          tone: 'check',
          title: `Oldest DLQ row has been pending ${Math.round(input.oldestPendingMinutes)}m`,
          reason: 'Pending > 30m usually means the retry worker is stalled or back-pressured.',
          primary: { kind: 'link', to: '/dlq?filter=pending', label: 'Open pending' },
        }
      }
      if (input.pendingCount > 0) {
        return {
          tone: 'check',
          title: `${input.pendingCount} pending DLQ ${input.pendingCount === 1 ? 'row' : 'rows'}`,
          reason: 'These will retry automatically — skim to confirm nothing is stuck on the same message.',
          primary: { kind: 'link', to: '/dlq', label: 'Open DLQ' },
        }
      }
      return null

    case 'prompt-lab':
      if (input.untestedDrafts > 0) {
        return {
          tone: 'do',
          title: `${input.untestedDrafts} untested prompt ${input.untestedDrafts === 1 ? 'draft' : 'drafts'}`,
          reason: 'Run evals against the golden set before promoting a draft to production.',
          primary: { kind: 'link', to: '/prompt-lab?filter=untested', label: 'Open drafts' },
        }
      }
      if (input.lastRunHoursAgo == null || input.lastRunHoursAgo > 7 * 24) {
        return {
          tone: 'check',
          title: 'Eval set has not run this week',
          reason: 'Regression tests on prompts drift fast — kick a run so the judge has fresh baselines.',
          primary: { kind: 'link', to: '/prompt-lab?action=eval', label: 'Run eval set' },
        }
      }
      if (input.draftCount === 0) {
        return {
          tone: 'plan',
          title: 'Draft your first prompt variant',
          reason: 'Iterating prompts in the Lab is how you raise judge scores without touching code.',
          primary: { kind: 'link', to: '/prompt-lab?action=new', label: 'New draft' },
        }
      }
      return null

    case 'repo':
      if (input.reposWithoutIndex > 0) {
        return {
          tone: 'do',
          title: `${input.reposWithoutIndex} ${input.reposWithoutIndex === 1 ? 'repo is' : 'repos are'} not indexed`,
          reason: 'Without an index the graph + auto-fixer cannot reason about blast radius.',
          primary: { kind: 'link', to: '/repo?filter=unindexed', label: 'Trigger indexer' },
        }
      }
      if (input.staleIndexHoursAgo != null && input.staleIndexHoursAgo > 24 * 7) {
        return {
          tone: 'check',
          title: `Repo index is ${Math.floor(input.staleIndexHoursAgo / 24)}d old`,
          reason: 'A stale index hides new components and masks regressions in the graph view.',
          primary: { kind: 'link', to: '/repo?action=reindex', label: 'Re-index' },
        }
      }
      return null

    case 'mcp':
      if (input.expiringKeysIn7Days > 0) {
        return {
          tone: 'do',
          title: `${input.expiringKeysIn7Days} MCP ${input.expiringKeysIn7Days === 1 ? 'key expires' : 'keys expire'} this week`,
          reason: 'When a key expires, that MCP client silently stops sending reports — rotate now.',
          primary: { kind: 'link', to: '/mcp?filter=expiring', label: 'Rotate keys' },
        }
      }
      if (input.unconfiguredClients > 0) {
        return {
          tone: 'plan',
          title: `${input.unconfiguredClients} MCP ${input.unconfiguredClients === 1 ? 'client is' : 'clients are'} unconfigured`,
          reason: 'Finish the MCP install so the IDE agent can file bugs directly from chats.',
          primary: { kind: 'link', to: '/mcp', label: 'Open MCP setup' },
        }
      }
      return null

    case 'billing':
      if (input.pastDueInvoices > 0) {
        return {
          tone: 'do',
          title: `${input.pastDueInvoices} past-due ${input.pastDueInvoices === 1 ? 'invoice' : 'invoices'}`,
          reason: 'Past-due invoices block paid-plan features — resolve before the next billing cycle.',
          primary: { kind: 'link', to: '/billing?status=past_due', label: 'Open invoices' },
        }
      }
      if (input.projectedOverrunPct != null && input.projectedOverrunPct > 20) {
        return {
          tone: 'check',
          title: `Projected to overshoot monthly cap by ${input.projectedOverrunPct.toFixed(0)}%`,
          reason: 'Increase the cap or throttle the pipeline before Stripe invoices the overage.',
          primary: { kind: 'link', to: '/billing?action=raise-cap', label: 'Review cap' },
        }
      }
      return null

    case 'notifications':
      if (input.unreadCritical > 0) {
        return {
          tone: 'do',
          title: `${input.unreadCritical} unread critical ${input.unreadCritical === 1 ? 'alert' : 'alerts'}`,
          reason: 'Critical alerts page on-call channels — triage so the next page has context.',
          primary: { kind: 'link', to: '/notifications?severity=critical', label: 'Open critical inbox' },
        }
      }
      if (input.totalUnread > 10) {
        return {
          tone: 'check',
          title: `${input.totalUnread} unread notifications`,
          reason: 'Skim to confirm nothing that matters is buried behind low-priority spam.',
          primary: { kind: 'link', to: '/notifications', label: 'Open inbox' },
        }
      }
      return null

    case 'marketplace':
      if (input.installableUpdates > 0) {
        return {
          tone: 'check',
          title: `${input.installableUpdates} plugin ${input.installableUpdates === 1 ? 'update' : 'updates'} available`,
          reason: 'Plugin updates ship schema fixes and security patches — apply inside the quiet window.',
          primary: { kind: 'link', to: '/marketplace?filter=updates', label: 'Review updates' },
        }
      }
      if (input.disabledPlugins > 0) {
        return {
          tone: 'check',
          title: `${input.disabledPlugins} installed ${input.disabledPlugins === 1 ? 'plugin is' : 'plugins are'} disabled`,
          reason: 'Disabled plugins can be re-enabled or uninstalled to reduce attack surface.',
          primary: { kind: 'link', to: '/marketplace?filter=disabled', label: 'Review disabled' },
        }
      }
      return null

    case 'integrations':
      if (input.disconnectedCount > 0) {
        return {
          tone: 'do',
          title: `${input.disconnectedCount} ${input.disconnectedCount === 1 ? 'integration is' : 'integrations are'} disconnected`,
          reason: 'Reconnect the OAuth link so notifications and fix dispatch keep flowing.',
          primary: { kind: 'link', to: '/integrations?status=disconnected', label: 'Reconnect' },
        }
      }
      if (input.expiringCount > 0) {
        return {
          tone: 'check',
          title: `${input.expiringCount} integration ${input.expiringCount === 1 ? 'token expires' : 'tokens expire'} soon`,
          reason: 'Rotate before expiry or the integration will silently stop delivering.',
          primary: { kind: 'link', to: '/integrations?status=expiring', label: 'Rotate tokens' },
        }
      }
      return null

    default:
      return null
  }
}

/**
 * Thin wrapper so pages can `const action = useNextBestAction({ scope: 'audit', ... })`.
 * Kept as a hook (not a pure call) so we can add page-level telemetry / Sentry
 * breadcrumbs later without touching consumers.
 */
export function useNextBestAction(input: Input): PageAction | null {
  return computeNextBestAction(input)
}

export type { Scope as PageScope, Input as PageActionInput }
