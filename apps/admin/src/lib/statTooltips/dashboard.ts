/**
 * FILE: apps/admin/src/lib/statTooltips/dashboard.ts
 * PURPOSE: Human-readable StatCard tooltips for the Dashboard LOOP SNAPSHOT strip.
 */

import type { MetricTooltipData } from '../../components/ui'
import type { DashboardStats } from '../../components/dashboard/DashboardStatsTypes'
import { metricTip } from '../metricTooltipBuilder'

export function backlogTooltip(stats: DashboardStats): MetricTooltipData {
  const takeaway =
    stats.openBacklog > 0
      ? `${stats.openBacklog} report${stats.openBacklog === 1 ? '' : 's'} have sat in new or queued status for over an hour. Triage them on Reports → Queue before dispatching fixes.`
      : 'No reports are stuck waiting for triage — the Plan stage of your PDCA loop is current.'

  return metricTip(
    'Reports in new or queued status that have been waiting more than one hour to be triaged.',
    'Counts reports rows with status new or queued where created_at is older than 60 minutes, within the rolling 14-day window for the active project.',
    takeaway,
    stats.openBacklog > 0
      ? { tone: 'warn', text: 'Stale triage backlog slows the whole loop — start with the oldest new report.' }
      : undefined,
  )
}

export function backlogDetail(stats: DashboardStats): string {
  return stats.openBacklog > 0 ? 'Needs triage > 1h' : 'Queue clear'
}

export function reports14dTooltip(stats: DashboardStats): MetricTooltipData {
  const takeaway = stats.hasData
    ? `${stats.reports14d} report${stats.reports14d === 1 ? '' : 's'} landed in the last 14 days — intake is active. Pair with Reports for severity breakdown and queue depth.`
    : 'No reports in the last 14 days yet. Finish SDK setup and send a test report to populate this strip.'

  return metricTip(
    'How many bug reports were ingested in the rolling last 14 days (UTC).',
    'Counts every reports row whose created_at falls within the last 14 days for projects you can access.',
    takeaway,
    !stats.hasData && stats.setupDone
      ? { tone: 'info', text: 'Setup is complete but no recent intake — verify the SDK heartbeat and send a test report.' }
      : undefined,
  )
}

export function reports14dDetail(stats: DashboardStats): string {
  return stats.hasData ? 'Intake active' : 'Waiting for ingest'
}

export function fixesTooltip(stats: DashboardStats): MetricTooltipData {
  const takeaway =
    stats.fixesFailed > 0
      ? `${stats.fixesFailed} fix attempt${stats.fixesFailed === 1 ? '' : 's'} failed in 14d. Open Fixes to retry or inspect failure categories before dispatching more.`
      : stats.fixesInProgress > 0
        ? `${stats.fixesInProgress} fix${stats.fixesInProgress === 1 ? '' : 'es'} queued or running — the Do stage is busy.`
        : stats.openPrs > 0
          ? `${stats.openPrs} completed fix${stats.openPrs === 1 ? '' : 'es'} left an open PR awaiting review or merge.`
          : 'No fix attempts are queued or running in the last 14 days.'

  let callout: MetricTooltipData['callout']
  if (stats.fixesFailed > 0) {
    callout = {
      tone: 'warn',
      text: `${stats.fixesFailed} failed fix${stats.fixesFailed === 1 ? '' : 'es'} in 14d — inspect logs before retrying.`,
    }
  } else if (stats.openPrs > 0 && stats.fixesInProgress === 0) {
    callout = {
      tone: 'info',
      text: `${stats.openPrs} open PR${stats.openPrs === 1 ? '' : 's'} from completed fixes — merge or close to advance Act.`,
    }
  }

  return metricTip(
    'Fix attempts currently queued or running in the rolling 14-day window.',
    'Counts fix_attempts rows with status queued or running, created within the last 14 days. Failed count and open PRs appear in the detail line and callout.',
    takeaway,
    callout,
  )
}

export function fixesDetail(stats: DashboardStats): string {
  if (stats.fixesFailed > 0) return `${stats.fixesFailed} failed`
  if (stats.openPrs > 0) return `${stats.openPrs} PR${stats.openPrs === 1 ? '' : 's'} open`
  return 'None in flight'
}

export function focusTooltip(stats: DashboardStats): MetricTooltipData {
  const stage = stats.focusStage
  const stageExplain: Record<string, string> = {
    plan: 'Plan — triage backlog is the bottleneck.',
    do: 'Do — failed fix attempts need attention.',
    act: 'Act — one or more integrations are failing health checks.',
    check: 'Check — LLM invocations are erroring in the 14-day window.',
  }

  const takeaway = stats.bottleneck
    ? stats.bottleneck
    : stats.setupDone
      ? 'All PDCA stages look balanced — no single bottleneck flagged in the last 14 days.'
      : `${stats.requiredComplete}/${stats.requiredTotal} onboarding steps done. Finish ingest to unlock full loop metrics.`

  let callout: MetricTooltipData['callout']
  if (stats.bottleneck) {
    callout = { tone: 'warn', text: stats.bottleneck }
  } else if (!stats.setupDone) {
    callout = {
      tone: 'info',
      text: `${stats.requiredComplete}/${stats.requiredTotal} setup steps complete — finish onboarding to unlock the loop.`,
    }
  }

  return metricTip(
    stats.focusLabel
      ? `Which PDCA stage needs attention right now — currently ${stats.focusLabel}.`
      : 'Which PDCA stage (Plan / Do / Check / Act) needs attention, or whether the loop is balanced.',
    stage
      ? stageExplain[stage] ?? 'Derived from backlog, failed fixes, integration health, and LLM error counts in the 14-day window.'
      : 'When no bottleneck is detected, focus stays neutral. Setup progress shows until all four onboarding steps are complete.',
    takeaway,
    callout,
  )
}

export function focusDetail(stats: DashboardStats): string {
  return stats.bottleneck ?? (stats.setupDone ? 'Loop balanced' : `${stats.requiredComplete}/${stats.requiredTotal} setup`)
}
