/**
 * FILE: apps/admin/src/lib/statTooltips/experiments.ts
 * PURPOSE: Human-readable StatCard tooltips for the Experiments EXPERIMENTS SNAPSHOT strip.
 */

import type { MetricTooltipData } from '../../components/ui'
import type { ExperimentsStats } from '../../components/experiments/ExperimentsStatsTypes'
import { metricTip } from '../metricTooltipBuilder'

export function totalExperimentsTooltip(stats: ExperimentsStats): MetricTooltipData {
  const takeaway =
    stats.totalExperiments > 0
      ? `${stats.totalExperiments} experiment${stats.totalExperiments === 1 ? '' : 's'} total (${stats.draftCount} draft). Open Experiments tab to launch or stop tests.`
      : stats.hasAnyProject
        ? 'No experiments yet — create one from the New tab with at least two variants.'
        : 'Select a project to run A/B experiments.'

  return metricTip(
    'All experiments defined for the active project, including drafts and completed runs.',
    'Counts experiments rows for the project. draftCount is the subset in draft status (not yet running).',
    takeaway,
    stats.totalExperiments === 0 && stats.hasAnyProject
      ? { tone: 'info', text: 'No experiments — start from New tab with two variants.' }
      : undefined,
  )
}

export function totalExperimentsDetail(stats: ExperimentsStats): string {
  return `${stats.draftCount} draft`
}

export function runningCountTooltip(stats: ExperimentsStats): MetricTooltipData {
  const takeaway =
    stats.runningCount > 0
      ? `${stats.runningCount} experiment${stats.runningCount === 1 ? ' is' : 's are'} live — users are being assigned to variants now.`
      : 'No experiments currently running — all tests are draft, stopped, or completed.'

  return metricTip(
    'Experiments actively assigning users to variants (status = running).',
    'Counts experiments rows where status = running for the active project.',
    takeaway,
    stats.runningCount > 0
      ? { tone: 'info', text: `${stats.runningCount} live experiment${stats.runningCount === 1 ? '' : 's'} — monitor conversion before stopping.` }
      : undefined,
  )
}

export function runningCountDetail(): string {
  return 'Live assignment'
}

export function draftsReadyToLaunchTooltip(stats: ExperimentsStats): MetricTooltipData {
  const takeaway =
    stats.draftsReadyToLaunch > 0
      ? `${stats.draftsReadyToLaunch} draft${stats.draftsReadyToLaunch === 1 ? '' : 's'} ha${stats.draftsReadyToLaunch === 1 ? 's' : 've'} ≥2 variants and can launch immediately.`
      : stats.draftCount > 0
        ? `${stats.draftCount} draft${stats.draftCount === 1 ? '' : 's'} need more variants before launch.`
        : 'No drafts waiting to launch.'

  return metricTip(
    'Draft experiments that have at least two variants configured and are ready to start.',
    'Counts draft experiments where variant count ≥ 2 (minimum for meaningful A/B assignment).',
    takeaway,
    stats.draftsReadyToLaunch > 0
      ? { tone: 'info', text: `${stats.draftsReadyToLaunch} ready to launch — start from Experiments tab.` }
      : undefined,
  )
}

export function draftsReadyToLaunchDetail(): string {
  return '≥2 variants'
}

export function winnersFoundTooltip(stats: ExperimentsStats): MetricTooltipData {
  const takeaway =
    stats.winnersFound > 0
      ? `${stats.winnersFound} experiment${stats.winnersFound === 1 ? '' : 's'} ha${stats.winnersFound === 1 ? 's' : 've'} a declared winner — roll out the winning variant in product code.`
      : 'No declared winners yet — complete a running experiment with statistical significance first.'

  return metricTip(
    'Experiments where a winning variant has been formally declared.',
    'Counts experiments rows with winner_variant_id set (or status = completed with winner).',
    takeaway,
    stats.winnersFound > 0
      ? { tone: 'info', text: `${stats.winnersFound} winner${stats.winnersFound === 1 ? '' : 's'} declared — ship the winning variant.` }
      : undefined,
  )
}

export function winnersFoundDetail(): string {
  return 'Declared'
}

export function totalAssignmentsTooltip(stats: ExperimentsStats): MetricTooltipData {
  const takeaway =
    stats.totalAssignments > 0
      ? `${stats.totalAssignments.toLocaleString()} user assignment${stats.totalAssignments === 1 ? '' : 's'} (${stats.totalConversions.toLocaleString()} converted).`
      : 'No assignments yet — launch a running experiment to start bucketing users.'

  return metricTip(
    'Total variant assignments recorded for all experiments, and how many converted.',
    'Sums experiment_assignments rows; totalConversions counts assignments where converted_at is set.',
    takeaway,
  )
}

export function totalAssignmentsDetail(stats: ExperimentsStats): string {
  return `${stats.totalConversions} converted`
}

export function conversionRateTooltip(stats: ExperimentsStats): MetricTooltipData {
  const takeaway =
    stats.conversionRatePct > 0
      ? `${stats.conversionRatePct}% overall conversion across all experiments (${stats.banditEnabledCount} using bandit allocation).`
      : 'Zero conversions recorded — verify conversion events fire when users complete the goal action.'

  return metricTip(
    'Overall conversion rate across all experiment assignments (conversions ÷ assignments × 100).',
    'totalConversions ÷ totalAssignments × 100, aggregated project-wide. banditEnabledCount is experiments with adaptive traffic allocation.',
    takeaway,
    stats.conversionRatePct === 0 && stats.totalAssignments > 0
      ? { tone: 'info', text: 'Assignments exist but no conversions — check goal event wiring.' }
      : undefined,
  )
}

export function conversionRateDetail(stats: ExperimentsStats): string {
  return `${stats.banditEnabledCount} bandit`
}
