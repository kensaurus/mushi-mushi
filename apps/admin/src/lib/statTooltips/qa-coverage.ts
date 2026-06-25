/**
 * FILE: apps/admin/src/lib/statTooltips/qa-coverage.ts
 * PURPOSE: Human-readable StatCard tooltips for the QA Coverage QA SNAPSHOT strip.
 */

export type { PlainStatTooltipOpts } from '../usePlainStatTooltips'

import type { MetricTooltipData } from '../../components/ui'
import type { QaCoverageStats } from '../../components/qa-coverage/QaCoverageStatsTypes'
import { metricTip } from '../metricTooltipBuilder'

export function totalStoriesTooltip(stats: QaCoverageStats): MetricTooltipData {
  const takeaway =
    stats.totalStories > 0
      ? `${stats.totalStories} QA stor${stats.totalStories === 1 ? 'y' : 'ies'} (${stats.enabledStories} enabled). Schedule cron on Stories tab for continuous coverage.`
      : stats.hasAnyProject
        ? 'No QA stories yet — author user-story tests from Reports or the Stories tab.'
        : 'Select a project to define QA coverage stories.'

  return metricTip(
    'Total QA user-story tests defined for the project, and how many are enabled for scheduled runs.',
    'Counts qa_stories rows; enabledStories is the subset where enabled = true.',
    takeaway,
    stats.totalStories === 0 && stats.hasAnyProject
      ? { tone: 'info', text: 'No stories — generate from a report or write one on Stories tab.' }
      : undefined,
  )
}

export function totalStoriesDetail(stats: QaCoverageStats): string {
  return `${stats.enabledStories} enabled`
}

export function passingStoriesTooltip(stats: QaCoverageStats): MetricTooltipData {
  const takeaway =
    stats.passingStories > 0
      ? `${stats.passingStories} stor${stats.passingStories === 1 ? 'y' : 'ies'} at ≥80% pass rate in the last 24h — healthy coverage.`
      : stats.totalStories > 0
        ? 'No stories at ≥80% pass rate in 24h — check Failing tab for regressions.'
        : 'Passing count appears after stories run at least once.'

  return metricTip(
    'Enabled QA stories whose 24-hour pass rate is at or above 80%.',
    'Reads qa_story_coverage_24h materialized view — passing when pass_rate_pct ≥ 80 for enabled stories.',
    takeaway,
  )
}

export function passingStoriesDetail(): string {
  return '≥80% in 24h'
}

export function failingStoriesTooltip(stats: QaCoverageStats): MetricTooltipData {
  const takeaway =
    stats.failingStories > 0
      ? `${stats.failingStories} stor${stats.failingStories === 1 ? 'y' : 'ies'} below 80% pass rate in 24h${stats.topFailingStoryName ? ` — worst: ${stats.topFailingStoryName}.` : '.'}`
      : 'No failing stories in the 24h window — coverage is green.'

  return metricTip(
    'Enabled QA stories whose 24-hour pass rate is below 80%.',
    'qa_story_coverage_24h where pass_rate_pct < 80 for enabled stories in the rolling 24h window.',
    takeaway,
    stats.failingStories > 0
      ? { tone: 'warn', text: `${stats.failingStories} failing stor${stats.failingStories === 1 ? 'y' : 'ies'} — open Failing tab for evidence.` }
      : undefined,
  )
}

export function failingStoriesDetail(): string {
  return '<80% in 24h'
}

export function avgPassRateTooltip(stats: QaCoverageStats): MetricTooltipData {
  const takeaway =
    stats.avgPassRatePct != null
      ? stats.avgPassRatePct >= 80
        ? `${stats.avgPassRatePct}% average pass rate across enabled stories in 24h — above the 80% bar.`
        : `${stats.avgPassRatePct}% average pass rate — below 80%; prioritize failing stories.`
      : 'Average pass rate unavailable — stories need at least one run in the 24h window.'

  return metricTip(
    'Mean pass rate (%) across all enabled QA stories in the rolling 24-hour window.',
    'Average of pass_rate_pct from qa_story_coverage_24h for enabled stories with run data.',
    takeaway,
    stats.avgPassRatePct != null && stats.avgPassRatePct < 80
      ? { tone: 'warn', text: `Avg pass rate ${stats.avgPassRatePct}% — below 80% target.` }
      : undefined,
  )
}

export function avgPassRateDetail(): string {
  return '24h window'
}

export function runs24hTooltip(stats: QaCoverageStats): MetricTooltipData {
  const takeaway =
    stats.totalRuns24h > 0
      ? `${stats.totalRuns24h} QA run${stats.totalRuns24h === 1 ? '' : 's'} in 24h${stats.pendingRuns > 0 ? ` (${stats.pendingRuns} still in flight).` : '.'}`
      : 'No QA runs in the last 24h — enable stories and verify cron or trigger a manual run.'

  return metricTip(
    'Total QA story execution runs in the rolling last 24 hours.',
    'Counts qa_story_runs rows with started_at in the last 24h. pendingRuns is status = pending or running.',
    takeaway,
    stats.pendingRuns > 0
      ? { tone: 'info', text: `${stats.pendingRuns} run${stats.pendingRuns === 1 ? '' : 's'} in flight — refresh for results.` }
      : undefined,
  )
}

export function runs24hDetail(stats: QaCoverageStats): string {
  return `${stats.pendingRuns} in flight`
}

export function noDataStoriesTooltip(stats: QaCoverageStats): MetricTooltipData {
  const takeaway =
    stats.noDataStories > 0
      ? `${stats.noDataStories} enabled stor${stats.noDataStories === 1 ? 'y has' : 'ies have'} no run data in 24h — schedule or trigger manually.`
      : 'Every enabled story has 24h run data.'

  return metricTip(
    'Enabled stories that have never run or have no executions in the last 24 hours.',
    'Enabled qa_stories with no matching qa_story_runs in the 24h window (or never executed).',
    takeaway,
    stats.noDataStories > 0
      ? { tone: 'info', text: `${stats.noDataStories} stor${stats.noDataStories === 1 ? 'y' : 'ies'} without 24h data — run or enable cron.` }
      : undefined,
  )
}

export function noDataStoriesDetail(): string {
  return 'Never run / 24h'
}
