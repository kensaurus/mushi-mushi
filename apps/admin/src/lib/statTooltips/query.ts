/**
 * FILE: apps/admin/src/lib/statTooltips/query.ts
 * PURPOSE: Human-readable StatCard tooltips for the Query snapshot strip.
 */

import type { MetricTooltipData } from '../../components/ui'
import type { QueryStats } from '../../components/query/types'
import { metricTip } from '../metricTooltipBuilder'

export function runs24hTooltip(stats: QueryStats): MetricTooltipData {
  const takeaway =
    stats.runs24h > 0
      ? `${stats.runs24h} quer${stats.runs24h === 1 ? 'y' : 'ies'} in 24h (${stats.nlRuns24h} natural-language, ${stats.rawRuns24h} raw SQL).`
      : stats.projectId
        ? 'No queries in the last 24h — try Ask tab with a schema-aware question.'
        : 'Select a project to run analytics queries.'

  return metricTip(
    'Query executions in the rolling last 24 hours, split by NL vs raw SQL mode.',
    'Counts query_runs rows in 24h. nlRuns24h = mode nl; rawRuns24h = mode raw or sql.',
    takeaway,
  )
}

export function runs24hDetail(stats: QueryStats): string {
  return `${stats.nlRuns24h} NL · ${stats.rawRuns24h} raw`
}

export function errors24hTooltip(stats: QueryStats): MetricTooltipData {
  const takeaway =
    stats.errors24h > 0
      ? `${stats.errors24h} failed run${stats.errors24h === 1 ? '' : 's'} in 24h${stats.lastRunError ? ' — latest error in History tab.' : '.'}`
      : stats.lastRunError
        ? 'Latest run failed but no errors counted in 24h rollup — check History for the most recent failure.'
        : 'All recent runs succeeded — no errors in the 24h window.'

  return metricTip(
    'Query runs that ended in error in the last 24 hours.',
    'Counts query_runs where status = error and started_at within 24h. lastRunError surfaces the newest failure message.',
    takeaway,
    stats.errors24h > 0
      ? { tone: 'warn', text: `${stats.errors24h} error${stats.errors24h === 1 ? '' : 's'} in 24h — review History for bad SQL or schema drift.` }
      : undefined,
  )
}

export function errors24hDetail(stats: QueryStats): string {
  return stats.lastRunError ? 'Latest run failed' : 'All recent runs OK'
}

export function savedCountTooltip(stats: QueryStats): MetricTooltipData {
  const takeaway =
    stats.savedCount > 0
      ? `${stats.savedCount} saved quer${stats.savedCount === 1 ? 'y' : 'ies'} (${stats.teamSavedCount} shared with the team).`
      : 'No saved queries — pin useful runs from History to reuse them.'

  return metricTip(
    'Saved query definitions for the project, including team-shared pins.',
    'Counts saved_queries rows for the project. teamSavedCount is queries marked shared / team-visible.',
    takeaway,
  )
}

export function savedCountDetail(stats: QueryStats): string {
  return `${stats.teamSavedCount} from team`
}

export function latencyTooltip(stats: QueryStats): MetricTooltipData {
  const takeaway =
    stats.avgLatencyMs != null
      ? `Average query latency ${stats.avgLatencyMs}ms in recent runs${stats.recentCount > 0 ? ` · ${stats.recentCount} unpinned recent runs in History.` : '.'}`
      : stats.recentCount > 0
        ? `${stats.recentCount} recent unpinned runs — latency average pending more executions.`
        : 'No recent runs — latency appears after the first query executes.'

  return metricTip(
    'Mean execution latency (ms) for recent query runs, with unpinned recent run count in detail.',
    'Average duration_ms from query_runs in the recent window. recentCount = unpinned runs not yet saved.',
    takeaway,
    stats.schemaDegraded
      ? { tone: 'warn', text: 'Schema cache degraded — latency may spike until Schema tab refreshes.' }
      : undefined,
  )
}

export function latencyDetail(stats: QueryStats): string {
  return stats.recentCount > 0 ? `${stats.recentCount} recent unpinned` : 'No recent runs'
}
