/**
 * FILE: apps/admin/src/lib/actionInboxFromDashboard.ts
 * PURPOSE: Builds the Action Inbox card model from `/v1/admin/dashboard`.
 * Shared by `/inbox` and `useNavCounts` so sidebar badge counts match the
 * page without duplicating derivation rules.
 */

import { computeNextBestAction } from './useNextBestAction'
import type { PageAction } from '../components/PageActionBar'
import type { DashboardData } from '../components/dashboard/types'
import type { InboxStats } from '../components/inbox/types'
import { stoppedTitle } from './countDefinitions'

/**
 * Counters from `/v1/admin/inbox/stats`, the source the banner and the "do
 * this next" line count from. When given they win over the dashboard
 * payload, so a stage card is never ticked while the banner counts it open.
 */
export type InboxCardBuildContext =
  | (Pick<InboxStats, 'judgeStale' | 'judgeStaleHours'> &
      Partial<Pick<InboxStats, 'urgentOpenReports' | 'integrationRed' | 'integrationAmber'>> & {
        /**
         * The app's stuck pipeline groups, biggest first (lib/pipelineSignals.ts needsYouGroups):
         * the same items Home's "Needs you" lists. Absent: no pipeline card; null: the read failed
         * or is loading, so the card says "not checked" (round-2 review, 2026-11-18: Home listed
         * "2 reports: triaged over 3 days ago" and this page did not).
         */
        pipelineNeedsYou?: ReadonlyArray<{ id: string; label: string; count: number }> | null
        /** Local worker problems (GET /v1/admin/work/lanes flags); null when not read. */
        workerProblems?: number | null
      })
  | undefined

export type InboxCardGroup = 'plan' | 'do' | 'check' | 'act' | 'ops'

/**
 * How a card stands. `pass` is the only state drawn with a ✓: the thing was checked and is
 * fine. `none` has nothing to check yet (no fix ever ran); `unknown` was not read. "Fixes in
 * flight ✓" showed with no fixes at all (round-2 review, 2026-11-18).
 */
type InboxCardState = 'open' | 'pass' | 'none' | 'unknown'

export interface InboxCard {
  id: string
  scope: string
  group: InboxCardGroup
  pageLabel: string
  pageTo: string
  action: PageAction | null
  state: InboxCardState
}

const stateOf = (action: PageAction | null, idle: 'pass' | 'none' | 'unknown' = 'pass'): InboxCardState => (action ? 'open' : idle)

function resolveJudgeAction(ctx: InboxCardBuildContext): PageAction | null {
  // The server only sets judgeStale when old scores AND ungraded reports
  // coexist. Age alone (judgeStale=false, judgeStaleHours=335) means a re-run
  // would grade nothing, so don't ask for one.
  const staleHoursAgo = ctx?.judgeStale === false ? null : (ctx?.judgeStaleHours ?? null)
  const fromRules = computeNextBestAction({
    scope: 'judge',
    disagreementRate: null,
    sampledCount: 0,
    staleHoursAgo,
  })
  if (fromRules) return fromRules
  // Server marks judgeStale when no eval exists; computeNextBestAction only checks >48h.
  if (ctx?.judgeStale && staleHoursAgo == null) {
    return {
      tone: 'plan',
      title: 'No quality scores yet — run a first check',
      reason: 'Mushi Mushi grades its own bug triage so you can trust the severity labels. One click starts the first check.',
      primary: { kind: 'link', to: '/judge?action=run', label: 'Run quality check' },
    }
  }
  return null
}

/**
 * The one count every place on /inbox reads: the banner, the Stages tab badge and the filter
 * chips. The banner said "1 thing needs you" from /inbox/stats over three open cards, and the
 * chips read "All 6 · Open 3 · Clear 2" with the sixth card in neither (round-3 review,
 * 2026-11-19). `unchecked` holds the cards with nothing to check yet or no read, so
 * open + settled + unchecked = total.
 */
export function inboxCardCounts(cards: ReadonlyArray<Pick<InboxCard, 'action' | 'state'>>): {
  open: number
  settled: number
  unchecked: number
  total: number
} {
  const open = cards.filter((c) => c.action !== null).length
  const settled = cards.filter((c) => c.action === null && c.state === 'pass').length
  return { open, settled, unchecked: cards.length - open - settled, total: cards.length }
}

export function buildInboxCards(
  data: DashboardData | undefined,
  ctx?: InboxCardBuildContext,
): InboxCard[] {
  // Critical reports from the last 14 days that still need a decision. The
  // sum of reportsByDay counted fixed and dismissed ones too, so the card
  // stayed open for 14 days after every critical was closed.
  const critical14d = data?.counts?.openCritical14d ?? 0
  const openBacklog = data?.counts?.openBacklog ?? 0
  const fixSummary = data?.fixSummary
  const failedFixes = fixSummary?.failed ?? 0
  // 2026-10-16: the banner said "3 open actions" while every card was ticked.
  // The server counts a `down` probe as red and opens Plan on urgent reports
  // that are triaged but unfixed; this list knew neither.
  const urgentOpen = ctx?.urgentOpenReports ?? 0
  const integrations = data?.integrations ?? []
  const redIntegrations =
    ctx?.integrationRed ??
    integrations.filter((i) => i.lastStatus === 'red' || i.lastStatus === 'fail' || i.lastStatus === 'down').length
  const amberIntegrations =
    ctx?.integrationAmber ??
    integrations.filter((i) => i.lastStatus === 'amber' || i.lastStatus === 'degraded').length
  // Nothing to judge health by: no integration is set up and the stats did not count any.
  const noIntegrations = integrations.length === 0 && ctx?.integrationRed == null
  const workerProblems = ctx?.workerProblems ?? 0

  const healthAction = computeNextBestAction({
    scope: 'health',
    redCount: redIntegrations,
    amberCount: amberIntegrations,
  })
  // Local worker problems get their own card. On Integration health they read as an integration
  // fault while "Act · Integrations" stayed ✓ on the same page (round-3 review, 2026-11-19).
  const workerAction: PageAction | null =
    workerProblems > 0
      ? {
          tone: 'do',
          title: `${workerProblems} local worker problem${workerProblems === 1 ? ' stops' : 's stop'} fixes`,
          reason: 'A machine running Mushi Mushi work is offline, stuck or out of credits. Each problem has its fix on the Workers tab.',
          primary: { kind: 'link', to: '/pipeline?tab=workers', label: 'Open Workers' },
        }
      : null
  const integrationsAction = computeNextBestAction({
    scope: 'integrations',
    disconnectedCount: redIntegrations,
    expiringCount: 0,
  })
  const fixesAction: PageAction | null =
    failedFixes > 0
      ? {
          tone: 'do',
          title: stoppedTitle(failedFixes),
          reason: 'Read why the last attempt stopped, then retry or fix it in your editor.',
          primary: { kind: 'link', to: '/fixes?tab=attempts&status=failed', label: 'See why it stopped' },
        }
      : null

  const pipelineGroups = ctx?.pipelineNeedsYou
  const pipelineTotal = (pipelineGroups ?? []).reduce((n, g) => n + g.count, 0)
  const pipelineTop = pipelineGroups?.[0]
  const pipelineAction: PageAction | null =
    pipelineTop && pipelineGroups
      ? {
          tone: 'do',
          title: pipelineGroups.length === 1 ? pipelineTop.label : `${pipelineTotal} items are stuck in the pipeline`,
          reason:
            pipelineGroups.length === 1
              ? 'Open it to see each item and the fix the pipeline offers.'
              : `${pipelineGroups.length} groups. The biggest: ${pipelineTop.label}.`,
          primary: { kind: 'link', to: `/pipeline?group=${encodeURIComponent(pipelineTop.id)}`, label: 'Open the pipeline' },
        }
      : null
  const pipelineCard: InboxCard[] =
    pipelineGroups === undefined
      ? []
      : [
          {
            id: 'pipeline-do',
            scope: 'pipeline',
            group: 'do',
            pageLabel: 'Pipeline',
            pageTo: '/pipeline',
            action: pipelineAction,
            state: pipelineGroups === null ? 'unknown' : stateOf(pipelineAction),
          },
        ]

  const workerCard: InboxCard[] =
    ctx?.workerProblems === undefined
      ? []
      : [
          {
            id: 'workers-do',
            scope: 'workers',
            group: 'do',
            pageLabel: 'Local workers',
            pageTo: '/pipeline?tab=workers',
            action: workerAction,
            state: ctx?.workerProblems === null ? 'unknown' : stateOf(workerAction),
          },
        ]

  const reportsAction: PageAction | null =
        critical14d > 0
          ? {
              tone: 'do',
              title: `${critical14d} critical report${critical14d === 1 ? ' needs' : 's need'} a decision`,
              reason: 'From the last 14 days. Confirm severity on the worst bugs first; auto-fix waits for triage.',
              primary: { kind: 'link', to: '/reports?status=open&severity=critical&days=14', label: 'Open critical queue' },
            }
          : urgentOpen > 0
            ? {
                // Same wording and list as the server's Plan flag.
                tone: 'do',
                title: `${urgentOpen} critical or high report${urgentOpen === 1 ? ' is' : 's are'} still unfixed`,
                reason: 'Read each diagnosis, then dispatch a fix or close it as not a code bug.',
                primary: { kind: 'link', to: '/reports?status=open', label: 'Review & fix' },
              }
          : openBacklog > 0
            ? {
                // Stalled non-critical queue used to render an EMPTY inbox
                // (2026-08-16 audit: 12 reports stuck in 'classified' and the
                // inbox said nothing) — surface the backlog even without
                // criticals.
                tone: 'plan',
                title: `${openBacklog} report${openBacklog === 1 ? '' : 's'} waiting for triage`,
                reason: 'No criticals, but the queue is not clear — review, dispatch, or dismiss to keep the loop moving.',
                // openBacklog counts New reports waiting over an hour: open
                // that bucket, oldest first (it used to open Classified).
                primary: { kind: 'link', to: '/reports?status=new&sort=created_at&dir=asc', label: 'Open triage queue' },
              }
            : null
  const judgeAction = resolveJudgeAction(ctx)

  return [
    {
      id: 'reports-plan',
      scope: 'intelligence',
      group: 'plan',
      pageLabel: 'Reports queue',
      pageTo: '/reports',
      action: reportsAction,
      state: stateOf(reportsAction, data ? 'pass' : 'unknown'),
    },
    {
      id: 'judge-check',
      scope: 'judge',
      group: 'check',
      pageLabel: 'Judge',
      pageTo: '/judge',
      action: judgeAction,
      state: stateOf(judgeAction),
    },
    // Stuck pipeline work sits next to failed fixes, the same list Home's "Needs you" shows.
    ...pipelineCard,
    {
      id: 'fixes-do',
      scope: 'fixes',
      group: 'do',
      pageLabel: 'Fixes in flight',
      pageTo: '/fixes',
      action: fixesAction,
      // No fix ever ran (or none in the window): nothing to pass, so no ✓.
      state: stateOf(fixesAction, !data ? 'unknown' : (fixSummary?.total ?? 0) === 0 ? 'none' : 'pass'),
    },
    ...workerCard,
    {
      id: 'health-ops',
      scope: 'health',
      group: 'ops',
      pageLabel: 'Integration health',
      pageTo: '/health',
      action: healthAction,
      state: stateOf(healthAction, noIntegrations ? 'none' : 'pass'),
    },
    {
      id: 'integrations-act',
      scope: 'integrations',
      group: 'act',
      pageLabel: 'Integrations',
      pageTo: '/integrations/config',
      action: integrationsAction,
      state: stateOf(integrationsAction, noIntegrations ? 'none' : 'pass'),
    },
  ]
}
