/**
 * FILE: apps/admin/src/lib/statTooltips/iterate.ts
 * PURPOSE: Human-readable StatCard tooltips for the Iterate improvement-loop snapshot strip.
 */

import type { MetricTooltipData } from '../../components/ui'
import type { IterateStats } from '../../components/iterate/IterateStatsTypes'
import { metricTip } from '../metricTooltipBuilder'
import type { PlainStatTooltipOpts } from '../usePlainStatTooltips'

type Opts = PlainStatTooltipOpts

export function totalRunsTooltip(stats: IterateStats, opts: Opts = {}): MetricTooltipData {
  const plain = opts.plainLanguage ?? false
  const takeaway =
    stats.total > 0
      ? plain
        ? `${stats.total} improvement run${stats.total === 1 ? '' : 's'} on this project${stats.lastRunAt ? ` — last queued ${stats.daysSinceLastRun != null ? `${stats.daysSinceLastRun}d ago` : 'recently'}.` : '.'}`
        : `${stats.total} PDCA run${stats.total === 1 ? '' : 's'} on this project${stats.lastRunAt ? ` — last queued ${stats.daysSinceLastRun != null ? `${stats.daysSinceLastRun}d ago` : 'recently'}.` : '.'}`
      : plain
        ? 'No improvement runs yet — queue a target URL with critic persona and score target on the New Run tab.'
        : 'No PDCA runs yet — queue a target URL with critic persona and score target on the New Run tab.'

  return metricTip(
    plain
      ? 'All producer → critic improvement runs ever queued for the active project.'
      : 'All producer → critic PDCA runs ever queued for the active project.',
    'Counts every pdca_runs row for the project (all statuses including aborted).',
    takeaway,
    stats.total === 0
      ? { tone: 'info', text: 'Start on New Run — paste a URL, pick a critic, set target score.' }
      : undefined,
  )
}

export function totalRunsDetail(opts: Opts = {}): string {
  const plain = opts.plainLanguage ?? false
  return plain ? 'All improvement runs' : 'All PDCA runs'
}

export function activeRunsTooltip(stats: IterateStats, opts: Opts = {}): MetricTooltipData {
  const plain = opts.plainLanguage ?? false
  const active = stats.running + stats.queued
  const takeaway =
    active > 0
      ? `${active} run${active === 1 ? '' : 's'} in flight (${stats.running} running · ${stats.queued} queued) — Runs tab auto-refreshes every 4s.`
      : plain
        ? 'No runs queued or executing — loop is idle.'
        : 'No runs queued or executing — pipeline idle.'

  return metricTip(
    plain
      ? 'Improvement runs currently queued or executing the producer → critic loop.'
      : 'PDCA runs currently queued or executing the producer → critic loop.',
    'Sums pdca_runs rows with status queued or running for the active project.',
    takeaway,
    stats.queued > 0 && stats.running === 0
      ? { tone: 'info', text: `${stats.queued} queued — click Trigger on Runs tab to start the pdca-runner.` }
      : stats.running > 0
        ? { tone: 'info', text: `${stats.running} running — open Runs tab to watch iterations live.` }
        : undefined,
  )
}

export function activeRunsDetail(stats: IterateStats): string {
  return `${stats.running} running · ${stats.queued} queued`
}

export function succeededRunsTooltip(stats: IterateStats, opts: Opts = {}): MetricTooltipData {
  const plain = opts.plainLanguage ?? false
  const takeaway =
    stats.succeeded > 0
      ? `${stats.succeeded} run${stats.succeeded === 1 ? '' : 's'} met exit criteria (status succeeded).${stats.aborted > 0 ? ` ${stats.aborted} aborted.` : ''}`
      : 'No runs have succeeded yet — finish a producer → critic loop or inspect failures on Runs.'

  return metricTip(
    plain
      ? 'Improvement runs that finished with status succeeded (met configured exit criteria).'
      : 'PDCA runs that finished with status succeeded (met configured exit criteria).',
    'Counts pdca_runs rows with status succeeded for the active project.',
    takeaway,
  )
}

export function succeededRunsDetail(): string {
  return 'Met exit criteria'
}

export function failedRunsTooltip(stats: IterateStats, opts: Opts = {}): MetricTooltipData {
  const plain = opts.plainLanguage ?? false
  const takeaway =
    stats.failed > 0
      ? `${stats.failed} run${stats.failed === 1 ? '' : 's'} failed${stats.lastFailedUrl ? ` — latest on ${stats.lastFailedUrl}.` : '.'} Open the run drawer to inspect critic feedback.`
      : 'No failed runs — when a run fails, inspect iterations on Runs before re-queueing.'

  return metricTip(
    plain
      ? 'Improvement runs that ended in failed status (critic rejected or runner error).'
      : 'PDCA runs that ended in failed status (critic rejected or runner error).',
    'Counts pdca_runs rows with status failed. lastFailedUrl is the most recent failed target_url.',
    takeaway,
    stats.failed > 0
      ? { tone: 'warn', text: 'Failed run — inspect iterations, adjust target, then queue a new run.' }
      : undefined,
  )
}

export function failedRunsDetail(): string {
  return 'Need inspection'
}

export function avgScoreTooltip(stats: IterateStats): MetricTooltipData {
  const takeaway =
    stats.avgFinalScorePct != null
      ? `Average final critic score ${stats.avgFinalScorePct}% across scored runs · ${stats.runsMeetingTarget} met their target score.`
      : 'No scored runs yet — final_score is set when a run completes the critic loop.'

  return metricTip(
    'Mean final critic score across runs that recorded a final_score.',
    'Averages pdca_runs.final_score (0–1) for rows where final_score is not null, displayed as a percentage. runsMeetingTarget counts runs where final_score ≥ target_score.',
    takeaway,
    stats.avgFinalScorePct != null && stats.avgFinalScorePct < 70
      ? { tone: 'warn', text: 'Average score below 70% — review critic persona or lower target on New Run.' }
      : undefined,
  )
}

export function avgScoreDetail(stats: IterateStats): string {
  return `${stats.runsMeetingTarget} met target`
}

export function iterationsTooltip(stats: IterateStats, opts: Opts = {}): MetricTooltipData {
  const plain = opts.plainLanguage ?? false
  const takeaway =
    stats.totalIterations > 0
      ? `${stats.totalIterations} producer → critic iteration step${stats.totalIterations === 1 ? '' : 's'} logged across all runs.`
      : 'No iteration rows yet — steps appear once a run starts executing.'

  return metricTip(
    plain
      ? 'Total producer → critic iteration steps across all improvement runs.'
      : 'Total producer → critic iteration steps across all PDCA runs.',
    'Counts pdca_iterations rows whose run_id belongs to a pdca_run on this project.',
    takeaway,
  )
}

export function iterationsDetail(): string {
  return 'Producer → critic steps'
}
