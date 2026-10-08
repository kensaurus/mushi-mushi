/**
 * FILE: apps/admin/src/lib/statTooltips/fixes.ts
 * PURPOSE: Human-readable StatCard tooltips for the Fixes FIXES SNAPSHOT strip.
 */

import type { MetricTooltipData } from '../../components/ui'
import type { FixesStats } from '../../components/fixes/FixesStatsTypes'
import { metricTip } from '../metricTooltipBuilder'
import { fixCauseLabel } from '../fixReportTruth'
import type { PlainStatTooltipOpts } from '../usePlainStatTooltips'

type Opts = PlainStatTooltipOpts

function inFlightCount(stats: FixesStats): number {
  return stats.inProgress + stats.inflightDispatches
}

export function totalAttemptsTooltip(stats: FixesStats, opts: Opts = {}): MetricTooltipData {
  const plain = opts.plainLanguage ?? false
  const takeaway =
    stats.totalAttempts > 0
      ? `${stats.totalAttempts} fix attempt${stats.totalAttempts === 1 ? '' : 's'} dispatched in 30d. Filter the list to In flight for runs still going.`
      : plain
        ? 'No fix attempts in the last 30 days — dispatch from a reviewed report once GitHub and codebase index are wired.'
        : 'No fix attempts in the last 30 days — dispatch from a triaged report once GitHub and codebase index are wired.'

  return metricTip(
    'All fix-worker dispatches in the rolling last 30 days.',
    'Counts every fix_attempts row with created_at in the last 30 days for the active project (up to 500 most recent).',
    takeaway,
    !stats.hasGithub
      ? { tone: 'warn', text: 'Connect GitHub in Integrations to enable auto-fix dispatch.' }
      : stats.codebaseIndexEnabled === false && stats.indexedFiles === 0
        ? { tone: 'warn', text: 'Index your codebase so fix-worker can ground patches in real files.' }
        : undefined,
  )
}

export function totalAttemptsDetail(): string {
  return 'dispatched'
}

export function completedTooltip(stats: FixesStats): MetricTooltipData {
  const takeaway =
    stats.completed > 0
      ? `${stats.completed} report${stats.completed === 1 ? '' : 's'} fixed${stats.successRatePct != null ? ` (${stats.successRatePct}% of reports that finished)` : ''}. Check open PRs for merge backlog.`
      : 'No report fixed by auto-fix in 30d — nothing dispatched yet, or fixes are still in flight or stopped.'

  return metricTip(
    'Reports that are fixed: a fix PR merged, or the report was marked fixed.',
    'Counts each report with a fix attempt in the last 30 days once, by its current state — not each attempt.',
    takeaway,
  )
}

/** "4 of 5 reports fixed": the success rate's own numerator and denominator. */
export function completedDetail(stats: FixesStats): string {
  const finished = stats.completed + stats.failed
  return finished > 0 ? `${stats.completed} of ${finished} reports fixed` : 'no finished runs'
}

export function failedTooltip(stats: FixesStats, opts: Opts = {}): MetricTooltipData {
  const plain = opts.plainLanguage ?? false
  const top =
    stats.topFailureCategory && stats.topFailureCount > 0
      ? `Most common: ${fixCauseLabel(stats.topFailureCategory)} (${stats.topFailureCount}×).`
      : ''

  const takeaway =
    stats.failed > 0
      ? `${stats.failed} report${stats.failed === 1 ? ' is' : 's are'} still unfixed after the last attempt. ${top} Open each one to read why, then retry or fix it in your editor.`
      : plain
        ? 'No unfixed report is waiting on a stopped fix — fix drafts are clean or have not run yet.'
        : 'No unfixed report is waiting on a stopped fix — the pipeline is clean or has not run yet.'

  return metricTip(
    'Reports still unfixed whose latest fix attempt failed, was skipped, or whose PR went red on CI or was closed unmerged.',
    'Counts each report once, by its latest attempt. A report fixed by a later merged PR, or dismissed, is never counted, however many earlier attempts failed.',
    takeaway,
    stats.failed > 0
      ? {
          tone: 'warn',
          text: stats.topFailureCategory
            ? `${stats.failed} unfixed — most common cause: ${fixCauseLabel(stats.topFailureCategory)}.`
            : `${stats.failed} unfixed report${stats.failed === 1 ? '' : 's'} need attention.`,
        }
      : undefined,
  )
}

export function failedDetail(stats: FixesStats): string {
  return stats.topFailureCategory ? fixCauseLabel(stats.topFailureCategory) : 'needs attention'
}

export function inProgressTooltip(stats: FixesStats): MetricTooltipData {
  const inFlight = inFlightCount(stats)
  const takeaway =
    inFlight > 0
      ? `${inFlight} report${inFlight === 1 ? '' : 's'} with a fix queued or running right now. Check back shortly — dispatches usually finish in minutes.`
      : 'Nothing queued or running — dispatch a fix from Reports or Fixes when ready.'

  return metricTip(
    'Reports with a fix queued or running now.',
    'Counts each unfixed report once: those with a queued or running attempt, plus those whose dispatch is queued before its attempt starts.',
    takeaway,
    inFlight > 3
      ? { tone: 'info', text: `${inFlight} fixes in flight — watch for retry storms if failures spike.` }
      : undefined,
  )
}

export function inProgressDetail(): string {
  return 'queued or running'
}

export function prsOpenTooltip(stats: FixesStats): MetricTooltipData {
  const takeaway =
    stats.prsOpen > 0
      ? `${stats.prsOpen} fix attempt${stats.prsOpen === 1 ? ' has' : 's have'} a PR awaiting review or merge. Clear the merge backlog to advance Act.`
      : 'No open fix PRs — the merge queue is clear or no fixes have finished yet.'

  return metricTip(
    'Fix attempts with a pull request still open on GitHub, whatever CI says.',
    'Counts each loaded attempt with an open PR, the same rule as Pull requests. A closed or merged PR is not open; a red-CI PR is also counted under Failed.',
    takeaway,
    stats.prsOpen > 0
      ? { tone: 'info', text: `${stats.prsOpen} PR${stats.prsOpen === 1 ? '' : 's'} awaiting review — merge or close to advance the loop.` }
      : undefined,
  )
}

export function prsOpenDetail(): string {
  return 'attempts awaiting review'
}

export function prsCiPassingTooltip(stats: FixesStats): MetricTooltipData {
  const takeaway =
    stats.prsCiPassing > 0
      ? `${stats.prsCiPassing} attempt${stats.prsCiPassing === 1 ? '' : 's'} recorded check_run_conclusion success — CI green on the fix PR.`
      : stats.prsOpen > 0
        ? 'Open PRs exist but none show a passing check run yet — CI may still be running or checks failed.'
        : 'No passing CI check runs logged for fix PRs in 30d.'

  return metricTip(
    'Fix attempts with an open PR whose GitHub check run concluded with success.',
    'Counts each loaded attempt with an open PR and a successful check run, the same rule as Pull requests.',
    takeaway,
    stats.prsOpen > 0 && stats.prsCiPassing === 0
      ? { tone: 'warn', text: 'Open PRs without passing CI — inspect check runs before merge.' }
      : undefined,
  )
}

export function prsCiPassingDetail(): string {
  return 'check-run success'
}
