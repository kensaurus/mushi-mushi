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
