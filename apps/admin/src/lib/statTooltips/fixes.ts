/**
 * FILE: apps/admin/src/lib/statTooltips/fixes.ts
 * PURPOSE: Human-readable StatCard tooltips for the Fixes FIXES SNAPSHOT strip.
 */

import type { MetricTooltipData } from '../../components/ui'
import type { FixesStats } from '../../components/fixes/FixesStatsTypes'
import { metricTip } from '../metricTooltipBuilder'

function inFlightCount(stats: FixesStats): number {
  return stats.inProgress + stats.inflightDispatches
}

export function totalAttemptsTooltip(stats: FixesStats): MetricTooltipData {
  const takeaway =
    stats.totalAttempts > 0
      ? `${stats.totalAttempts} fix attempt${stats.totalAttempts === 1 ? '' : 's'} dispatched in 30d.${stats.successRatePct != null ? ` Success rate: ${stats.successRatePct}%.` : ''} Open Pipeline for stage breakdown.`
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

export function totalAttemptsDetail(stats: FixesStats): string {
  if (stats.successRatePct != null) return `${stats.successRatePct}% success`
  return stats.totalAttempts > 0 ? 'dispatched' : 'total dispatched'
}

export function completedTooltip(stats: FixesStats): MetricTooltipData {
  const takeaway =
    stats.completed > 0
      ? `${stats.completed} attempt${stats.completed === 1 ? '' : 's'} reached completed status${stats.successRatePct != null ? ` (${stats.successRatePct}% of finished runs)` : ''}. Check open PRs for merge backlog.`
      : 'No completed fix runs in 30d — either nothing dispatched yet or attempts are still in flight or failed.'

  return metricTip(
    'Fix attempts that finished successfully and opened or updated a PR.',
    'Counts fix_attempts rows in the 30-day window where status equals completed.',
    takeaway,
  )
}

export function completedDetail(stats: FixesStats): string {
  return stats.successRatePct != null ? `${stats.successRatePct}% success` : 'no finished runs'
}

export function failedTooltip(stats: FixesStats): MetricTooltipData {
  const top =
    stats.topFailureCategory && stats.topFailureCount > 0
      ? `Most common: ${stats.topFailureCategory} (${stats.topFailureCount}×).`
      : ''

  const takeaway =
    stats.failed > 0
      ? `${stats.failed} attempt${stats.failed === 1 ? '' : 's'} failed in 30d. ${top} Inspect the timeline and retry after fixing root cause.`
      : 'No failed fix attempts in 30d — the pipeline is clean or has not run yet.'

  return metricTip(
    'Fix attempts that ended in failed status in the last 30 days.',
    'Counts fix_attempts rows where status equals failed. topFailureCategory is the most frequent failure_category among failed rows.',
    takeaway,
    stats.failed > 0
      ? {
          tone: 'warn',
          text: stats.topFailureCategory
            ? `${stats.failed} failed — top category: ${stats.topFailureCategory}.`
            : `${stats.failed} failed attempt${stats.failed === 1 ? '' : 's'} need attention.`,
        }
      : undefined,
  )
}

export function failedDetail(stats: FixesStats): string {
  return stats.topFailureCategory ? `top: ${stats.topFailureCategory}` : 'needs attention'
}

export function inProgressTooltip(stats: FixesStats): MetricTooltipData {
  const inFlight = inFlightCount(stats)
  const takeaway =
    inFlight > 0
      ? `${inFlight} fix${inFlight === 1 ? '' : 'es'} queued, pending, or running right now. Check back shortly — dispatches usually finish in minutes.`
      : 'Nothing queued or running — dispatch a fix from Reports or Fixes when ready.'

  return metricTip(
    'Fix attempts currently queued, pending, or running.',
    'Sums fix_attempts with status queued, running, or pending in the 30-day window, plus inflightDispatches (exact count of non-terminal rows project-wide).',
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
      ? `${stats.prsOpen} completed fix${stats.prsOpen === 1 ? '' : 'es'} left an open PR awaiting review or merge. Clear the merge backlog to advance Act.`
      : 'No open PRs from completed fixes — merge queue is clear or no fixes have finished yet.'

  return metricTip(
    'Completed fix attempts that still have an open pull request on GitHub.',
    'Counts fix_attempts rows in the 30-day window where status is completed and pr_url is set.',
    takeaway,
    stats.prsOpen > 0
      ? { tone: 'info', text: `${stats.prsOpen} PR${stats.prsOpen === 1 ? '' : 's'} awaiting review — merge or close to advance the loop.` }
      : undefined,
  )
}

export function prsOpenDetail(): string {
  return 'awaiting review'
}

export function prsCiPassingTooltip(stats: FixesStats): MetricTooltipData {
  const takeaway =
    stats.prsCiPassing > 0
      ? `${stats.prsCiPassing} attempt${stats.prsCiPassing === 1 ? '' : 's'} recorded check_run_conclusion success — CI green on the fix PR.`
      : stats.prsOpen > 0
        ? 'Open PRs exist but none show a passing check run yet — CI may still be running or checks failed.'
        : 'No passing CI check runs logged for fix PRs in 30d.'

  return metricTip(
    'Fix attempts whose GitHub check run concluded with success.',
    'Counts fix_attempts rows in the 30-day window where check_run_conclusion equals success.',
    takeaway,
    stats.prsOpen > 0 && stats.prsCiPassing === 0
      ? { tone: 'warn', text: 'Open PRs without passing CI — inspect check runs before merge.' }
      : undefined,
  )
}

export function prsCiPassingDetail(): string {
  return 'check-run success'
}
