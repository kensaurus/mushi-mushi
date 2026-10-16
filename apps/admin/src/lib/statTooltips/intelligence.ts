/**
 * FILE: apps/admin/src/lib/statTooltips/intelligence.ts
 * PURPOSE: Human-readable StatCard tooltips for the Intelligence SNAPSHOT strip.
 */

import type { MetricTooltipData } from '../../components/ui'
import type { IntelligenceStats } from '../../components/intelligence/IntelligenceStatsTypes'
import { metricTip } from '../metricTooltipBuilder'

export function digestsTooltip(stats: IntelligenceStats): MetricTooltipData {
  const takeaway =
    stats.reportCount > 0
      ? `${stats.reportCount} weekly digest${stats.reportCount === 1 ? '' : 's'} archived${stats.latestWeekStart ? ` — latest week ${stats.latestWeekStart}` : ''}.${stats.daysSinceLastDigest != null && stats.daysSinceLastDigest > 7 ? ` Last digest was ${stats.daysSinceLastDigest} days ago — generate this week.` : ''}`
      : stats.featureUnlocked
        ? 'No weekly digests yet — click Generate this week on Overview to archive the first narrative.'
        : 'Intelligence reports are locked on your plan — upgrade to archive weekly digests.'

  return metricTip(
    'Archived weekly intelligence digests for the active project.',
    'Counts intelligence_reports rows for the project, ordered by week_start. latestWeekStart is the most recent digest week.',
    takeaway,
    stats.featureUnlocked && stats.reportCount === 0
      ? { tone: 'info', text: 'Generate this week to seed the Reports tab with your first digest.' }
      : stats.daysSinceLastDigest != null && stats.daysSinceLastDigest > 7
        ? { tone: 'warn', text: `No digest in ${stats.daysSinceLastDigest} days — weekly narrative may be stale.` }
        : undefined,
  )
}

export function digestsDetail(stats: IntelligenceStats): string {
  return stats.latestWeekStart ? `Week ${stats.latestWeekStart}` : 'None archived'
}

export function activeJobsTooltip(stats: IntelligenceStats): MetricTooltipData {
  const takeaway =
    stats.activeJobCount > 0
      ? `${stats.activeJobCount} generation job${stats.activeJobCount === 1 ? '' : 's'} queued or running — page auto-refreshes while active.${stats.lastJobStatus ? ` Latest status: ${stats.lastJobStatus}.` : ''}`
      : stats.completedJobCount > 0
        ? `${stats.completedJobCount} job${stats.completedJobCount === 1 ? '' : 's'} completed — pipeline idle. Generate this week when you want a fresh digest.`
        : 'No generation jobs yet — the weekly LLM narrative has not been triggered for this project.'

  return metricTip(
    'Intelligence generation jobs currently queued or running.',
    'Counts intelligence_generation_jobs rows with status queued or running (last 20 jobs loaded for the project).',
    takeaway,
    stats.activeJobCount > 0
      ? { tone: 'info', text: 'Generation in progress — check Pipeline tab for job history.' }
      : undefined,
  )
}

export function activeJobsDetail(stats: IntelligenceStats): string {
  return `${stats.completedJobCount} completed`
}

export function failedJobsTooltip(stats: IntelligenceStats): MetricTooltipData {
  const takeaway =
    stats.failedJobCount > 0
      ? `${stats.failedJobCount} generation job${stats.failedJobCount === 1 ? '' : 's'} failed${stats.lastJobError ? ' — inspect error on Pipeline and verify LLM keys in Settings.' : '.'}`
      : stats.lastJobStatus
        ? `Latest job status: ${stats.lastJobStatus}. No failed jobs in the recent window.`
        : 'No generation jobs have run yet — failures will appear here after the first attempt.'

  return metricTip(
    'Weekly digest generation jobs that ended in failed status.',
    'Counts intelligence_generation_jobs rows with status failed among the most recent jobs for the project.',
    takeaway,
    stats.failedJobCount > 0
      ? { tone: 'warn', text: 'Failed generation — check Settings → LLM keys before retrying.' }
      : undefined,
  )
}

export function failedJobsDetail(stats: IntelligenceStats): string {
  return stats.lastJobStatus ?? 'No runs'
}

export function findingsTooltip(stats: IntelligenceStats): MetricTooltipData {
  const takeaway =
    stats.pendingFindings > 0
      ? `${stats.pendingFindings} pending modernization finding${stats.pendingFindings === 1 ? '' : 's'}${stats.securityFindings > 0 ? ` (${stats.securityFindings} security)` : ''} — review on Pipeline before dispatching fixes.`
      : 'No pending library modernization findings — codebase scan is current.'

  return metricTip(
    'Pending modernization findings from library scans (dependency drift, deprecations, security).',
    'Counts modernization_findings rows with status pending for the active project. securityFindings is the subset with severity security.',
    takeaway,
    stats.securityFindings > 0
      ? { tone: 'warn', text: `${stats.securityFindings} security finding${stats.securityFindings === 1 ? '' : 's'} — prioritize before other findings.` }
      : stats.pendingFindings > 0
        ? { tone: 'info', text: `${stats.pendingFindings} finding${stats.pendingFindings === 1 ? '' : 's'} awaiting review on Pipeline tab.` }
        : undefined,
  )
}

export function findingsDetail(stats: IntelligenceStats): string {
  return `${stats.securityFindings} security`
}

export function fixAttemptsTooltip(stats: IntelligenceStats): MetricTooltipData {
  const takeaway =
    stats.totalFixAttempts > 0
      ? `${stats.totalFixAttempts} fix attempt${stats.totalFixAttempts === 1 ? '' : 's'} rolled into digest stats · ${stats.fixCompletionRatePct}% completion rate on the latest digest.`
      : 'No fix attempts recorded in archived digests yet — dispatch fixes from Reports to populate this metric.'

  return metricTip(
    'Cumulative fix attempts referenced across archived weekly digests.',
    'Sums fixes.total from each intelligence_reports.stats JSON blob for the project. fixCompletionRatePct comes from the latest digest fixes.completionRate.',
    takeaway,
  )
}

export function fixAttemptsDetail(stats: IntelligenceStats): string {
  return `${stats.fixCompletionRatePct}% completion`
}

export function benchmarkingTooltip(stats: IntelligenceStats): MetricTooltipData {
  const takeaway = stats.benchmarkOptIn
    ? 'Benchmarking opt-in is on — anonymized KPIs may be included in cross-customer compare when the feature ships.'
    : stats.featureUnlocked
      ? 'Benchmarking is off — opt in on Overview when you want anonymized cross-customer KPI comparison.'
      : 'Benchmarking requires the intelligence_reports entitlement on your plan.'

  return metricTip(
    'Whether this project opted into anonymized cross-customer benchmarking.',
    'Reads project_settings.benchmarking_optin for the active project. featureUnlocked reflects the intelligence_reports plan flag.',
    takeaway,
    !stats.featureUnlocked
      ? { tone: 'info', text: 'Upgrade plan to unlock intelligence reports and benchmarking.' }
      : !stats.benchmarkOptIn
        ? { tone: 'info', text: 'Opt in on Overview → Benchmarking card when ready to share anonymized KPIs.' }
        : undefined,
  )
}

export function benchmarkingDetail(stats: IntelligenceStats): string {
  return stats.featureUnlocked ? 'Cross-customer compare' : 'Plan locked'
}
