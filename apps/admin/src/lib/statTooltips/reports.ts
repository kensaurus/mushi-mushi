/**
 * FILE: apps/admin/src/lib/statTooltips/reports.ts
 * PURPOSE: Human-readable StatCard tooltips for the Reports TRIAGE SNAPSHOT strip.
 */

import type { MetricTooltipData } from '../../components/ui'
import type { ReportsStats } from '../../components/reports/ReportsStatsTypes'
import { metricTip } from '../metricTooltipBuilder'

export function total14dTooltip(stats: ReportsStats): MetricTooltipData {
  const takeaway =
    stats.total14d > 0
      ? `${stats.total14d} report${stats.total14d === 1 ? '' : 's'} in 14d (${stats.totalAllTime.toLocaleString()} all-time). Use Severity tab for distribution and Queue for triage.`
      : stats.hasIngest
        ? 'No reports in the last 14 days despite prior ingest — check SDK connectivity or a quiet production window.'
        : 'No reports ingested yet. Complete onboarding and send a test report to populate triage metrics.'

  return metricTip(
    'Bug reports ingested in the rolling last 14 days (UTC).',
    'Counts every reports row with created_at in the last 14 days for projects you can access.',
    takeaway,
    !stats.hasIngest
      ? { tone: 'info', text: 'No ingest yet — verify SDK + send a test report from Onboarding.' }
      : undefined,
  )
}

export function total14dDetail(stats: ReportsStats): string {
  return stats.totalAllTime > 0 ? `${stats.totalAllTime} all-time` : 'No ingest yet'
}

export function untriagedTooltip(stats: ReportsStats): MetricTooltipData {
  const takeaway =
    stats.newUntriaged > 0
      ? `${stats.newUntriaged} report${stats.newUntriaged === 1 ? '' : 's'} still in new or queued status.${stats.openBacklog > 0 ? ` ${stats.openBacklog} ha${stats.openBacklog === 1 ? 's' : 've'} been waiting over an hour.` : ''} Triage before dispatching fixes.`
      : 'Every recent report has moved past new/queued — the triage queue is current.'

  return metricTip(
    'Reports still in new or queued status (not yet triaged or dismissed).',
    'Counts reports rows in the 14-day window where status is new or queued. openBacklog is the subset waiting longer than one hour.',
    takeaway,
    stats.openBacklog > 0
      ? { tone: 'warn', text: `${stats.openBacklog} report${stats.openBacklog === 1 ? '' : 's'} waiting > 1h to triage.` }
      : stats.newUntriaged > 0
        ? { tone: 'info', text: `${stats.newUntriaged} fresh report${stats.newUntriaged === 1 ? '' : 's'} in queue — triage while context is hot.` }
        : undefined,
  )
}

export function untriagedDetail(stats: ReportsStats): string {
  return stats.openBacklog > 0 ? `${stats.openBacklog} stale > 1h` : 'Queue current'
}

export function critical14dTooltip(stats: ReportsStats): MetricTooltipData {
  const takeaway =
    stats.critical14d > 0
      ? `${stats.critical14d} critical-severity report${stats.critical14d === 1 ? '' : 's'} in 14d${stats.newUntriaged > 0 ? ' — triage critical items before dispatch.' : '.'}${stats.high14d > 0 ? ` ${stats.high14d} high-severity also logged.` : ''}`
      : stats.high14d > 0
        ? `No critical reports in 14d, but ${stats.high14d} high-severity — review Severity tab for distribution.`
        : 'No critical or high-severity reports in the 14-day window.'

  return metricTip(
    'Reports classified with critical severity in the last 14 days.',
    'Counts reports rows in the 14-day window where severity (case-insensitive) equals critical.',
    takeaway,
    stats.critical14d > 0 && stats.newUntriaged > 0
      ? { tone: 'warn', text: 'Critical reports in queue — triage before auto-fix dispatch.' }
      : stats.critical14d > 0
        ? { tone: 'warn', text: `${stats.critical14d} critical report${stats.critical14d === 1 ? '' : 's'} in 14d.` }
        : undefined,
  )
}

export function critical14dDetail(stats: ReportsStats): string {
  return stats.high14d > 0 ? `${stats.high14d} high severity` : 'Severity rollup'
}

export function dismissed14dTooltip(stats: ReportsStats): MetricTooltipData {
  const takeaway =
    stats.dismissed14d > 0
      ? `${stats.dismissed14d} report${stats.dismissed14d === 1 ? '' : 's'} dismissed as noise or duplicate in 14d — normal for mature projects filtering flaky alerts.`
      : 'No reports dismissed in 14d — either everything was actionable or triage has not started filtering noise yet.'

  return metricTip(
    'Reports marked dismissed in the rolling 14-day window — filtered out as noise, duplicate, or not actionable.',
    'Counts reports rows in the 14-day window where status equals dismissed.',
    takeaway,
  )
}

export function dismissed14dDetail(): string {
  return 'Noise filtered out'
}
