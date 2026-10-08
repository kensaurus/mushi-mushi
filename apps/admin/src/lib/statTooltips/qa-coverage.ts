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

